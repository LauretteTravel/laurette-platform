import { connect } from "node:net";
import { HttpError } from "./http.js";
// ClamAV INSTREAM protocol; restricted to loopback, never a third-party upload.
export function scanAttachment(bytes) {
  const port = Number(process.env.ATTACHMENT_CLAMD_PORT || 3310);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new HttpError(503, "إعداد فاحص الملفات غير صالح");
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    let response = "",
      settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      error ? reject(error) : resolve();
    };
    const unavailable = () =>
      new HttpError(503, "فاحص الملفات غير متاح؛ لم يُحفظ الملف. راجع المسؤول");
    const timer = setTimeout(() => finish(unavailable()), 10000);
    socket.on("error", () => finish(unavailable()));
    socket.on("end", () => {
      if (!settled) finish(unavailable());
    });
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      for (let offset = 0; offset < bytes.length; offset += 65536) {
        const chunk = bytes.subarray(offset, offset + 65536),
          length = Buffer.alloc(4);
        length.writeUInt32BE(chunk.length);
        socket.write(length);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (response.length > 4096) return finish(unavailable());
      if (!response.includes("\0")) return;
      const answer = response.slice(0, response.indexOf("\0"));
      if (answer === "stream: OK") return finish();
      if (/^stream: .+ FOUND$/.test(answer))
        return finish(new HttpError(422, "رفض فحص الأمان الملف؛ لم يُحفظ"));
      finish(unavailable());
    });
  });
}
