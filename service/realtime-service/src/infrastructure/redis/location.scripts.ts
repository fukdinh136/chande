// All keys share {gps}. Lua keeps update, read and cleanup atomic with respect to each other.
export const UPDATE_LOCATION = `
local time = redis.call('TIME')
local now = tonumber(time[1])*1000 + math.floor(tonumber(time[2])/1000)
local id, recorded = ARGV[1], tonumber(ARGV[2])
local freshness, future = tonumber(ARGV[7]), tonumber(ARGV[8])
if recorded > now + future then return {'LOCATION_IN_FUTURE'} end
if now - recorded >= freshness then return {'LOCATION_STALE'} end
local previous = tonumber(redis.call('HGET', KEYS[4], id))
local raw = redis.call('HGET', KEYS[3], id)
if previous and recorded <= previous then
  if recorded == previous and raw then
    local old = cjson.decode(raw)
    if old.latitude == tonumber(ARGV[3]) and old.longitude == tonumber(ARGV[4]) and old.accuracy == tonumber(ARGV[5]) then
      return {'DUPLICATE', tostring(old.receivedAtMs)}
    end
  end
  return {'LOCATION_OUT_OF_ORDER'}
end
if raw then
  local old = cjson.decode(raw)
  if now - old.receivedAtMs < tonumber(ARGV[10]) then return {'RATE_LIMITED'} end
end
local metadata = { driverId=id, latitude=tonumber(ARGV[3]), longitude=tonumber(ARGV[4]), accuracy=tonumber(ARGV[5]), recordedAt=ARGV[6], recordedAtMs=recorded, receivedAtMs=now }
redis.call('GEOADD', KEYS[1], ARGV[4], ARGV[3], id)
redis.call('HSET', KEYS[3], id, cjson.encode(metadata))
redis.call('ZADD', KEYS[2], math.min(now,recorded)+freshness, id)
redis.call('HSET', KEYS[4], id, ARGV[2])
redis.call('ZADD', KEYS[5], now+tonumber(ARGV[9]), id)
return {'STORED', tostring(now)}
`;
export const FIND_NEARBY = `
local time = redis.call('TIME')
local now = tonumber(time[1])*1000 + math.floor(tonumber(time[2])/1000)
local rows = redis.call('GEOSEARCH', KEYS[1], 'FROMLONLAT', ARGV[2], ARGV[1], 'BYRADIUS', ARGV[3], 'm', 'ASC', 'WITHDIST')
if #rows > tonumber(ARGV[4]) then return {'SEARCH_CAPACITY_EXCEEDED'} end
local result = {}
for _, row in ipairs(rows) do
  local expires = tonumber(redis.call('ZSCORE', KEYS[2], row[1]))
  local raw = redis.call('HGET', KEYS[3], row[1])
  if raw and expires and expires > now then
    local metadata = cjson.decode(raw)
    metadata.distanceMeters = tonumber(row[2])
    table.insert(result, cjson.encode(metadata))
  end
end
return result
`;
export const CLEANUP_STALE = `
local time = redis.call('TIME')
local now = tonumber(time[1])*1000 + math.floor(tonumber(time[2])/1000)
local expired = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', now, 'LIMIT', 0, ARGV[1])
for _, id in ipairs(expired) do
  redis.call('ZREM', KEYS[1], id)
  redis.call('ZREM', KEYS[2], id)
  redis.call('HDEL', KEYS[3], id)
end
local oldOrder = redis.call('ZRANGEBYSCORE', KEYS[5], '-inf', now, 'LIMIT', 0, ARGV[1])
for _, id in ipairs(oldOrder) do
  redis.call('ZREM', KEYS[5], id)
  redis.call('HDEL', KEYS[4], id)
end
return #expired
`;
