const { io } = require("socket.io-client");

const token = process.env.TEST_DRIVER_TOKEN;
const driverId = process.env.TEST_DRIVER_ID;

if (!token || !driverId) {
  console.error(
    "Thieu TEST_DRIVER_TOKEN hoac TEST_DRIVER_ID."
  );
  process.exit(1);
}

const socket = io("http://localhost:3002", {
  auth: { token },
  transports: ["websocket"],
  reconnection: false,
  timeout: 5000,
  autoConnect: false,
});

const tests = [
  {
    name: "1. Gui vi tri hop le",
    payload: {
      driverId,
      lat: 21.0285,
      lng: 105.8542,
    },
    expectedCode: null,
  },
  {
    name: "2. Cap nhat vi tri moi",
    payload: {
      driverId,
      lat: 21.03,
      lng: 105.856,
    },
    expectedCode: null,
  },
  {
    name: "3. Tu choi latitude ngoai pham vi",
    payload: {
      driverId,
      lat: 100,
      lng: 105.8542,
    },
    expectedCode: "INVALID_PAYLOAD",
  },
  {
    name: "4. Tu choi toa do kieu chuoi",
    payload: {
      driverId,
      lat: "21.0285",
      lng: 105.8542,
    },
    expectedCode: "INVALID_PAYLOAD",
  },
  {
    name: "5. Tu choi cap nhat cho tai xe khac",
    payload: {
      driverId: "another-driver-id",
      lat: 21.0285,
      lng: 105.8542,
    },
    expectedCode: "FORBIDDEN",
  },
];

socket.on("connect", async () => {
  console.log("Socket connected:", socket.id);

  try {
    for (const test of tests) {
      const response = await socket
        .timeout(8000)
        .emitWithAck("driver_location_update", test.payload);

      const passed =
        test.expectedCode === null
          ? response?.success === true
          : response?.success === false &&
            response?.code === test.expectedCode;

      console.log(
        `${passed ? "PASS" : "FAIL"} - ${test.name}`
      );
      console.log(response);

      if (!passed) {
        process.exitCode = 1;
      }
    }
  } catch (error) {
    console.error("Test failed:", error.message);
    process.exitCode = 1;
  } finally {
    socket.disconnect();
  }
});

socket.on("auth_error", (error) => {
  console.error("Authentication failed:", error);
  process.exitCode = 1;
  socket.disconnect();
});

socket.on("connect_error", (error) => {
  console.error("Connection failed:", error.message);
  process.exitCode = 1;
  socket.disconnect();
});

socket.on("disconnect", (reason) => {
  console.log("Socket disconnected:", reason);
});

socket.connect();