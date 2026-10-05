-- Lưu một sự kiện chuyến một cách nguyên tử (gọi từ RedisTripEventInbox).
-- KEYS[1]: receipt theo eventId      KEYS[2]: version lớn nhất đã phát của chuyến
-- KEYS[3]: stream phát sự kiện cho mọi instance gateway
-- ARGV[1]: hash nội dung   ARGV[2]: tripVersion   ARGV[3]: thời gian giữ (giây)
-- ARGV[4]: độ dài tối đa của stream   ARGV[5]: JSON sự kiện   ARGV[6]: riderId   ARGV[7]: driverId hoặc ""
local existing = redis.call('GET', KEYS[1])
if existing then
  if existing == ARGV[1] then
    return 'DUPLICATE'
  end
  return 'CONFLICT'
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])

local current = tonumber(redis.call('GET', KEYS[2]) or '0')
if tonumber(ARGV[2]) <= current then
  return 'STALE'
end
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
redis.call('XADD', KEYS[3], 'MAXLEN', '~', ARGV[4], '*', 'event', ARGV[5], 'rider', ARGV[6], 'driver', ARGV[7])
return 'ACCEPTED'
