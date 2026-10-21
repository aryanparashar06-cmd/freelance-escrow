import net from "node:net";
import { createReadStream } from "node:fs";
import { PublicError } from "./security.js";

const MAX_RESPONSE_BYTES = 8 * 1024;

async function write(socket, chunk) {
  if (socket.write(chunk)) return;
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off("drain", onDrain);
      socket.off("error", onError);
      socket.off("close", onClose);
    };
    const onDrain = () => { cleanup(); resolve(); };
    const onError = (error) => { cleanup(); reject(error); };
    const onClose = () => { cleanup(); reject(new Error("scanner connection closed")); };
    socket.once("drain", onDrain);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

export async function scanFileWithClamAv({ config, filePath, connect = net.createConnection }) {
  const socket = connect({ host: config.clamavHost, port: config.clamavPort });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    socket.destroy(new Error("scanner timeout"));
  }, config.clamavScanTimeoutMs);
  timeout.unref?.();
  let response = Buffer.alloc(0);

  const connected = new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", () => reject(new PublicError(503, timedOut
      ? "Scanner timed out. Upload blocked."
      : "Scanner unavailable. Upload blocked.")));
  });

  try {
    await connected;
    await write(socket, Buffer.from("zINSTREAM\0"));
    for await (const chunk of createReadStream(filePath, { highWaterMark: 64 * 1024 })) {
      const length = Buffer.allocUnsafe(4);
      length.writeUInt32BE(chunk.length);
      await write(socket, length);
      await write(socket, chunk);
    }
    await write(socket, Buffer.alloc(4));
    socket.end();

    for await (const chunk of socket) {
      response = Buffer.concat([response, chunk]);
      if (response.length > MAX_RESPONSE_BYTES) throw new PublicError(503, "Scanner returned an invalid result. Upload blocked.");
    }
  } catch (error) {
    clearTimeout(timeout);
    socket.destroy();
    if (error instanceof PublicError) throw error;
    if (timedOut) throw new PublicError(503, "Scanner timed out. Upload blocked.");
    throw new PublicError(503, "Scanner unavailable. Upload blocked.");
  }

  clearTimeout(timeout);
  const message = response.toString("utf8").replace(/\0/g, "").trim();
  if (/\bFOUND$/i.test(message)) return { status: "infected" };
  if (/: OK$/i.test(message)) return { status: "clean" };
  throw new PublicError(503, "Scanner could not reliably inspect the file. Upload blocked.");
}
