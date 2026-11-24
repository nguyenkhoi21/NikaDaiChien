const zlib = require("zlib");
const crypto = require("crypto");

// Pomelo Package & Message constants
const Package = {
  TYPE_HANDSHAKE: 1,
  TYPE_HANDSHAKE_ACK: 2,
  TYPE_HEARTBEAT: 3,
  TYPE_DATA: 4,
  TYPE_KICK: 5,

  encode(type, body) {
    const len = body ? body.length : 0;
    const buf = Buffer.allocUnsafe(4 + len);
    buf[0] = type & 0xff;
    buf[1] = (len >> 16) & 0xff;
    buf[2] = (len >> 8) & 0xff;
    buf[3] = len & 0xff;
    if (body && len > 0) body.copy(buf, 4);
    return buf;
  },

  decode(buf) {
    const list = [];
    let offset = 0;
    while (offset + 4 <= buf.length) {
      const type = buf[offset];
      const len = (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];
      offset += 4;
      if (offset + len > buf.length) break;
      const body = len > 0 ? buf.subarray(offset, offset + len) : Buffer.alloc(0);
      offset += len;
      list.push({ type, body });
    }
    return list;
  }
};

const Message = {
  TYPE_REQUEST: 0,
  TYPE_NOTIFY: 1,
  TYPE_RESPONSE: 2,
  TYPE_PUSH: 3,

  _msgHasId(type) {
    return type === Message.TYPE_REQUEST || type === Message.TYPE_RESPONSE;
  },

  _msgHasRoute(type) {
    return type === Message.TYPE_REQUEST || type === Message.TYPE_NOTIFY || type === Message.TYPE_PUSH;
  },

  _caculateMsgIdBytes(id) {
    let len = 0;
    let n = id;
    do {
      len += 1;
      n >>>= 7;
    } while (n > 0);
    return len;
  },

  _encodeMsgId(id, buf, offset) {
    let n = id;
    do {
      let tmp = n % 128;
      const next = Math.floor(n / 128);
      if (next !== 0) tmp += 128;
      buf[offset++] = tmp;
      n = next;
    } while (n !== 0);
    return offset;
  },

  encode(id, type, compressRoute, route, msgBuf) {
    const idBytes = Message._msgHasId(type) ? Message._caculateMsgIdBytes(id) : 0;
    let msgLen = 1 + idBytes;
    let routeBuf = null;

    if (Message._msgHasRoute(type)) {
      if (compressRoute) {
        msgLen += 2;
      } else {
        msgLen += 1;
        if (route) {
          routeBuf = Buffer.from(String(route), "utf-8");
          msgLen += routeBuf.length;
        }
      }
    }
    if (msgBuf) msgLen += msgBuf.length;

    const buf = Buffer.allocUnsafe(msgLen);
    let offset = 0;
    buf[offset++] = (type << 1) | (compressRoute ? 1 : 0);

    if (Message._msgHasId(type)) {
      offset = Message._encodeMsgId(id, buf, offset);
    }

    if (Message._msgHasRoute(type)) {
      if (compressRoute) {
        buf[offset++] = (route >> 8) & 0xff;
        buf[offset++] = route & 0xff;
      } else if (routeBuf) {
        buf[offset++] = routeBuf.length & 0xff;
        routeBuf.copy(buf, offset);
        offset += routeBuf.length;
      } else {
        buf[offset++] = 0;
      }
    }

    if (msgBuf && msgBuf.length > 0) {
      msgBuf.copy(buf, offset);
    }
    return buf;
  },

  decode(buf) {
    let offset = 0;
    const flag = buf[offset++];
    const compressRoute = flag & 0x01;
    const type = (flag >> 1) & 0x07;

    let id = 0;
    if (Message._msgHasId(type)) {
      let m = 0;
      let i = 0;
      do {
        m = buf[offset++];
        id += (m & 0x7f) * Math.pow(2, 7 * i);
        i++;
      } while (m >= 128);
    }

    let route = null;
    if (Message._msgHasRoute(type)) {
      if (compressRoute) {
        route = (buf[offset++] << 8) | buf[offset++];
      } else {
        const routeLen = buf[offset++];
        if (routeLen > 0) {
          route = buf.subarray(offset, offset + routeLen).toString("utf-8");
          offset += routeLen;
        } else {
          route = "";
        }
      }
    }

    const body = buf.subarray(offset);
    return { id, type, compressRoute, route, body };
  }
};

// Matches client `util.utf8to16(zipUtils.unzipBase64(str))`
// Client zipUtils.unzipBase64 decodes Base64 -> gzip (0x1f 0x8b) or zlib (0x78 0xda) -> Latin1 char string -> util.utf8to16 decodes UTF-8 bytes to JS string.
function zipBase64(objOrStr) {
  const str = typeof objOrStr === "string" ? objOrStr : JSON.stringify(objOrStr);
  const gz = zlib.gzipSync(Buffer.from(str, "utf-8"));
  return gz.toString("base64");
}

function unzipBase64(b64) {
  const raw = Buffer.from(b64, "base64");
  const out = zlib.gunzipSync(raw);
  return out.toString("utf-8");
}

// RFC 6455 WebSocket helpers (supports binary frames 0x82 and fragmented frames)
function computeAcceptKey(wsKey) {
  return crypto
    .createHash("sha1")
    .update(wsKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
}

function encodeWsFrame(payload, opcode = 0x02) {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const len = buf.length;
  let header;
  if (len <= 125) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len <= 65535) {
    header = Buffer.allocUnsafe(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, buf]);
}

function parseWsFrames(state, chunk, onFrame) {
  state.buffer = Buffer.concat([state.buffer, chunk]);
  while (state.buffer.length >= 2) {
    const byte1 = state.buffer[0];
    const byte2 = state.buffer[1];
    const fin = (byte1 & 0x80) !== 0;
    const opcode = byte1 & 0x0f;
    const isMasked = (byte2 & 0x80) !== 0;
    let payloadLen = byte2 & 0x7f;
    let offset = 2;

    if (payloadLen === 126) {
      if (state.buffer.length < 4) break;
      payloadLen = state.buffer.readUInt16BE(2);
      offset = 4;
    } else if (payloadLen === 127) {
      if (state.buffer.length < 10) break;
      payloadLen = Number(state.buffer.readBigUInt64BE(2));
      offset = 10;
    }

    let maskKey = null;
    if (isMasked) {
      if (state.buffer.length < offset + 4) break;
      maskKey = state.buffer.subarray(offset, offset + 4);
      offset += 4;
    }

    if (state.buffer.length < offset + payloadLen) break;

    let data = state.buffer.subarray(offset, offset + payloadLen);
    state.buffer = state.buffer.subarray(offset + payloadLen);

    if (isMasked && maskKey) {
      const unmasked = Buffer.allocUnsafe(data.length);
      for (let i = 0; i < data.length; i++) {
        unmasked[i] = data[i] ^ maskKey[i % 4];
      }
      data = unmasked;
    }

    // Handle control frames immediately (ping/pong/close) even inside fragmented streams
    if (opcode >= 0x08) {
      onFrame(opcode, data);
      continue;
    }

    if (opcode !== 0x00) {
      state.fragOpcode = opcode;
      state.fragChunks = [data];
    } else {
      state.fragChunks.push(data);
    }

    if (fin) {
      const fullData = state.fragChunks.length === 1 ? state.fragChunks[0] : Buffer.concat(state.fragChunks);
      const finalOpcode = state.fragOpcode || 0x02;
      state.fragChunks = [];
      state.fragOpcode = 0;
      onFrame(finalOpcode, fullData);
    }
  }
}

module.exports = {
  Package,
  Message,
  zipBase64,
  unzipBase64,
  computeAcceptKey,
  encodeWsFrame,
  parseWsFrames
};
