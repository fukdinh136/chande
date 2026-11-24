// Mirrors User's BCrypt input limit as well as its character/letter/digit rules.
export function newPasswordProblem(value: string): string | undefined {
  if (value.length < 8 || value.length > 72 || !/^(?=.*[A-Za-z])(?=.*\d).+$/.test(value)) return 'Mật khẩu từ 8–72 ký tự, có cả chữ và số.';
  const bytes = [...value].reduce((size, char) => {const point = char.codePointAt(0)!; return size + (point <= 127 ? 1 : point <= 2047 ? 2 : point <= 65535 ? 3 : 4);}, 0);
  if (bytes > 72) return 'Mật khẩu tối đa 72 byte UTF-8; chữ có dấu thường chiếm 2–3 byte.';
}
