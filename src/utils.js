import crypto from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

export function randomNonce(length = 12) {
  const alphabet =
    "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678";
  const bytes = crypto.randomBytes(length);
  let output = "";
  for (let i = 0; i < length; i += 1) {
    output += alphabet[bytes[i] % alphabet.length];
  }
  return output;
}

export function formToJson(content = {}) {
  return JSON.stringify(content, null, 0);
}

export function secretGenerating(requestId, sid, hashKey) {
  let message = hashKey;
  const mod = 16;
  if (sid) {
    const length = Math.min(sid.length, mod);
    let encoded = "";
    for (let i = 0; i < length; i += 1) {
      const idx = sid.charCodeAt(i) % mod;
      encoded += sid[idx];
    }
    message += `_${encoded}`;
  }

  return crypto
    .createHmac("sha256", Buffer.from(requestId, "utf8"))
    .update(Buffer.from(message, "utf8"))
    .digest("hex")
    .slice(0, 16);
}

export function aesGcmEncrypt(rawData, secret) {
  const nonce = randomNonce(12);
  const cipher = crypto.createCipheriv(
    "aes-128-gcm",
    Buffer.from(secret, "utf8"),
    Buffer.from(nonce, "utf8"),
  );
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(rawData, "utf8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return (
    Buffer.from(nonce, "utf8").toString("base64") +
    Buffer.concat([ciphertext, tag]).toString("base64")
  );
}

export function aesGcmDecrypt(cipherData, secret) {
  const decoded = Buffer.from(cipherData, "base64");
  const nonce = decoded.subarray(0, 12);
  const encrypted = decoded.subarray(12);
  const ciphertext = encrypted.subarray(0, encrypted.length - 16);
  const tag = encrypted.subarray(encrypted.length - 16);
  const decipher = crypto.createDecipheriv(
    "aes-128-gcm",
    Buffer.from(secret, "utf8"),
    nonce,
  );
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8",
  );
}

export function restfulSign(hashKey, queryEncdata, bodyEncdata, data) {
  const headers = ["X-appKey", "X-requestId", "X-sid", "X-time", "X-token"];
  const headerSignStr = headers
    .map((header) => {
      const value = data[header] ?? "";
      return value ? `${header}=${value}` : "";
    })
    .filter(Boolean)
    .join("||");

  let signStr = headerSignStr;
  if (queryEncdata) {
    signStr += queryEncdata;
  }
  if (bodyEncdata) {
    signStr += bodyEncdata;
  }

  return crypto
    .createHmac("sha256", Buffer.from(hashKey, "utf8"))
    .update(Buffer.from(signStr, "utf8"))
    .digest("hex");
}

export function md5Hex(input) {
  return crypto.createHash("md5").update(input, "utf8").digest("hex");
}

export async function readJsonFile(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function writeJsonFile(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function parseMaybeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function withTimeoutSignal(timeoutMs) {
  return AbortSignal.timeout(timeoutMs);
}
