import { router } from 'expo-router';
import { useOffers } from '../state/offers-context';
import { Action, ErrorNotice, Notice } from './ui';

export function OfferWorkflowNotice({ showTripLink = true }: { showTripLink?: boolean }) {
  const value = useOffers();
  const closed = value.data?.status;
  return <>
    {value.phase === 'restoring' && <Notice>Đang khôi phục quyết định đã lưu. Chưa gửi lại thao tác nào.</Notice>}
    {value.phase === 'sending' && <Notice>Đang gửi quyết định. Thao tác dùng chung trên mọi màn hình.</Notice>}
    {value.phase === 'uncertain' && <Notice>Chưa rõ kết quả quyết định. Đang đọc lại trạng thái server; không tạo quyết định mới.</Notice>}
    {value.phase === 'blocked' && <Notice>Server chưa cho phép xử lý quyết định. Chỉ đối soát lời mời; không tự đổi key, body hoặc version để gửi lại.</Notice>}
    {value.phase === 'awaiting-assignment' && <Notice>Đang xác nhận chuyến. Matching đã nhận accept; cần Trip xác nhận đúng chuyến và tài xế. Không có chuyến ở lần đọc hiện tại chưa có nghĩa assignment thất bại.</Notice>}
    {value.phase === 'confirmed' && <Notice>Trip đã xác nhận phân công đúng chuyến cho tài xế. Matching vẫn giữ reservation cho tới khi chuyến đóng.</Notice>}
    {value.phase === 'closed' && <Notice>{closed === 'REJECTED' ? 'Matching từ chối assignment. Lời mời đã đóng.' : closed === 'EXPIRED' ? 'Server xác nhận lời mời đã hết hạn.' : closed === 'REVOKED' ? 'Server đã đóng hoặc thu hồi lời mời. Đọc Trip để xem tình trạng chuyến.' : 'Server đã xác nhận đóng lời mời / quyết định bỏ qua.'}</Notice>}
    {value.legacy && value.phase !== 'closed' && <Notice>Quyết định lưu từ phiên bản cũ thiếu endpoint cố định. Chỉ đối soát; không thể thử gửi lại an toàn.</Notice>}
    <ErrorNotice error={value.storageError || value.commandError || value.error} />
    {!!(value.storageError || value.commandError || value.error) && <Action label="Thử đối soát lại" disabled={value.busy || value.loading} onPress={value.refreshAll} />}
    {value.canRetry && <><Notice>Thử lại dùng nguyên endpoint, Idempotency-Key và body của quyết định cũ, kể cả khi thời gian lời mời đã hết.</Notice><Action label="Thử lại đúng quyết định đã lưu" onPress={value.retry} /></>}
    {showTripLink && value.phase === 'confirmed' && <Action label="Xem chuyến đã xác nhận" onPress={() => router.push('/driver/trip')} />}
  </>;
}
