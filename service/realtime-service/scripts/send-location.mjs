import { io } from 'socket.io-client';
const token = process.env.DRIVER_ACCESS_TOKEN;
const base = process.env.REALTIME_BASE_URL || 'http://127.0.0.1:3004';
const latitude = Number(process.env.GPS_LATITUDE), longitude = Number(process.env.GPS_LONGITUDE);
const accuracy = Number(process.env.GPS_ACCURACY || '12');
const count = Number(process.env.GPS_COUNT || '1'); // 0 = repeat until Ctrl+C.
if (!token || !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
    !Number.isInteger(count) || count < 0 || !process.env.GPS_LATITUDE || !process.env.GPS_LONGITUDE) {
  console.error('Set DRIVER_ACCESS_TOKEN, GPS_LATITUDE, GPS_LONGITUDE; optional GPS_COUNT=0 for a 10-second loop.');
  process.exitCode = 1;
} else {
  const socket = io(`${base.replace(/\/$/, '')}/realtime`, {
    auth: { token }, transports: ['websocket'], autoConnect: false, reconnection: false,
  });
  let timer, busy = false, sent = 0;
  const stop = () => { if (timer) clearInterval(timer); socket.removeAllListeners(); socket.disconnect(); };
  const send = () => {
    if (busy || !socket.connected) return;
    busy = true;
    socket.timeout(5000).emit('driver.location.update', {
      latitude, longitude, accuracy, recordedAt: process.env.GPS_RECORDED_AT || new Date().toISOString(),
    }, (error, reply) => {
      busy = false;
      // ACK includes times and requestId, no access token or raw GPS.
      if (error) { console.error('ACK_TIMEOUT'); process.exitCode = 1; stop(); return; }
      console.log(JSON.stringify(reply)); sent++;
      if (reply?.data?.accepted !== true) process.exitCode = 1;
      if (count && sent >= count) stop();
    });
  };
  socket.on('connect', () => { send(); timer = setInterval(send, 10000); });
  socket.on('connect_error', error => {
    console.error(error.data?.code || 'CONNECTION_FAILED'); process.exitCode = 1; stop();
  });
  socket.on('disconnect', () => stop());
  process.once('SIGINT', stop);
  socket.connect();
}
