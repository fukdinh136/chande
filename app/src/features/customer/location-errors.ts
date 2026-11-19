export class CustomerLocationError extends Error {
  constructor(readonly code: 'DENIED' | 'DISABLED' | 'TIMEOUT' | 'UNAVAILABLE' | 'CANCELLED') {super(code);}
}
export function locationMessage(error: unknown) {
  const code = error instanceof CustomerLocationError ? error.code : 'UNAVAILABLE';
  return code === 'DENIED' ? 'Chưa có quyền vị trí. Bạn có thể bật quyền trong cài đặt thiết bị hoặc chọn thủ công.' :
    code === 'DISABLED' ? 'Dịch vụ vị trí đang tắt. Bật vị trí trên thiết bị hoặc chọn thủ công.' :
    code === 'TIMEOUT' ? 'Lấy vị trí quá lâu. Bạn có thể thử lại hoặc chọn thủ công.' :
    'Chưa lấy được vị trí hiện tại. Bạn vẫn có thể chọn trên bản đồ hoặc địa chỉ yêu thích.';
}

