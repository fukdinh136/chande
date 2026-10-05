import { DataSource } from "typeorm";
export class DriverSchemaInspector {
  constructor(private readonly source: DataSource) {}
  async ready() {
    try {
      await this.assertSchema();
      return true;
    } catch {
      return false;
    }
  }
  async assertSchema() {
    const rows: {
      table_name: string;
      column_name: string;
      data_type: string;
      character_maximum_length: number | null;
      is_nullable: string;
    }[] = await this.source.query(
      `SELECT table_name,column_name,data_type,character_maximum_length,is_nullable FROM information_schema.columns WHERE table_schema=current_schema() AND table_name IN ('drivers','vehicles','driver_refresh_tokens')`,
    );
    const expected: Record<string, Record<string, string | number>> = {
      drivers: {
        id: "uuid",
        phone_number: 15,
        password_hash: 255,
        full_name: 100,
        avatar_url: "text",
        license_number: 20,
        status: 20,
        created_at: "timestamp with time zone",
        updated_at: "timestamp with time zone",
      },
      vehicles: {
        id: "uuid",
        driver_id: "uuid",
        vehicle_type: 20,
        license_plate: 15,
        brand_model: 100,
        color: 30,
        is_active: "boolean",
        created_at: "timestamp with time zone",
      },
      driver_refresh_tokens: {
        id: "uuid",
        driver_id: "uuid",
        token_hash: 64,
        expires_at: "timestamp with time zone",
        revoked_at: "timestamp with time zone",
        created_at: "timestamp with time zone",
      },
    };
    for (const [table, columns] of Object.entries(expected))
      for (const [column, type] of Object.entries(columns)) {
        const row = rows.find(
          (value) => value.table_name === table && value.column_name === column,
        );
        if (
          !row ||
          (typeof type === "number"
            ? row.data_type !== "character varying" ||
              row.character_maximum_length !== type
            : row.data_type !== type)
        )
          throw new Error(
            "Driver schema mapping mismatch; provide authoritative DDL",
          );
        if (
          (column === "avatar_url" || column === "revoked_at") &&
          row.is_nullable !== "YES"
        )
          throw new Error("Driver nullable mapping requires DDL review");
      }
    const constraints: { definition: string }[] = await this.source.query(
      "SELECT pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=current_schema() AND t.relname='drivers' AND c.contype='c'",
    );
    if (
      constraints.some(
        (row) =>
          /status/i.test(row.definition) &&
          /PENDING|ACTIVE|BLOCKED/.test(row.definition) &&
          !(/ONLINE/.test(row.definition) && /OFFLINE/.test(row.definition)),
      )
    )
      throw new Error(
        "Existing status CHECK conflicts with ONLINE/OFFLINE; schema change is not allowed",
      );
    const statuses: { status: string }[] = await this.source.query(
      "SELECT DISTINCT status FROM drivers",
    );
    if (statuses.some((row) => !["ONLINE", "OFFLINE"].includes(row.status)))
      throw new Error(
        "Legacy drivers.status requires reviewed data migration; no automatic mapping",
      );
    // Inspection only: no migration, synchronize, CREATE, ALTER or data reset.
  }
}
