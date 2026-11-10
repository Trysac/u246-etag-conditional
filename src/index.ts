import { createHash } from "node:crypto";

/**
 * Entity tag representation per RFC 9110 section 8.8.3.
 */
export interface EntityTag {
  weak: boolean;
  opaque: string;
}

/**
 * Result of evaluating preconditions per RFC 9110 section 13.2.2.
 */
export interface PreconditionResult {
  status: 200 | 304 | 412;
  reason:
    | "proceed"
    | "if_match_failed"
    | "if_unmodified_since_failed"
    | "if_none_match_matched"
    | "if_modified_since_not_modified";
  warnings: string[];
}

/**
 * Error thrown for malformed entity tags or invalid options.
 */
export class EtagError extends Error {
  readonly code: "malformed_etag" | "header_too_large" | "invalid_options";
  constructor(code: EtagError["code"], message: string) {
    super(message);
    this.name = "EtagError";
    this.code = code;
  }
}

/**
 * Computes an entity tag for a body using the first 16 bytes of its SHA-256 hash,
 * encoded as base64url and wrapped in a quoted string, optionally with a weak prefix.
 *
 * @param body - The resource body as a string (UTF-8) or raw bytes.
 * @param opts - Options, currently only `weak` (boolean, default false).
 * @returns The entity tag string, e.g. `"abc"` or `W/"abc"`.
 */
export function computeEtag(body: string | Uint8Array, opts?: { weak?: boolean }): string {
  const weak = opts?.weak ?? false;
  const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body);
  const hash = createHash("sha256").update(bytes).digest();
  const first16 = hash.subarray(0, 16);
  const base64url = first16.toString("base64url");
  return `${weak ? "W/" : ""}"${base64url}"`;
}

/**
 * Parses an entity tag list (comma-separated, optional whitespace) or the wildcard '*'.
 *
 * @param value - The header value to parse.
 * @returns An array of EntityTag objects, or the string '*' if the value is exactly that.
 * @throws {EtagError} With code 'malformed_etag' for syntactic errors or 'header_too_large'
 *   if the value exceeds 8192 characters or contains more than 100 tags.
 */
export function parseEntityTags(value: string): EntityTag[] | "*" {
  if (value.length > 8192) {
    throw new EtagError("header_too_large", "Entity-tag value exceeds 8192 characters");
  }
  const trimmed = value.trim();
  if (trimmed === "*") {
    return "*";
  }
  if (trimmed === "") {
    throw new EtagError("malformed_etag", "Empty entity-tag list");
  }
  const parts = splitTagList(trimmed);
  const tags: EntityTag[] = [];
  for (const part of parts) {
    const tagStr = part.trim();
    if (tagStr === "") continue;
    tags.push(parseSingleTag(tagStr));
  }
  if (tags.length === 0) {
    throw new EtagError("malformed_etag", "No entity tags found");
  }
  if (tags.length > 100) {
    throw new EtagError("header_too_large", "Entity-tag list exceeds 100 tags");
  }
  return tags;
}

/**
 * Splits an entity-tag list on commas that are not inside a quoted opaque tag,
 * so valid tags whose opaque bytes contain a comma (etagc includes 0x2C) stay intact.
 */
function splitTagList(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charAt(i);
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === "," && !inQuotes) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

function parseSingleTag(str: string): EntityTag {
  let weak = false;
  let i = 0;
  if (str.startsWith("W/")) {
    weak = true;
    i = 2;
  }
  if (i >= str.length || str[i] !== '"') {
    throw new EtagError("malformed_etag", `Malformed entity-tag: ${str}`);
  }
  i++;
  let opaque = "";
  while (i < str.length) {
    const code = str.charCodeAt(i);
    if (code === 0x22) {
      // double quote closes the tag
      if (i !== str.length - 1) {
        throw new EtagError("malformed_etag", `Unexpected characters after closing quote: ${str}`);
      }
      return { weak, opaque };
    }
    if ((code >= 0x21 && code <= 0x7e && code !== 0x22) || (code >= 0x80 && code <= 0xff)) {
      opaque += str.charAt(i);
      i++;
    } else {
      throw new EtagError("malformed_etag", `Invalid character in entity-tag: ${str}`);
    }
  }
  throw new EtagError("malformed_etag", `Unclosed entity-tag: ${str}`);
}

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) {
      if (value === undefined) return undefined;
      if (Array.isArray(value)) return value.join(", ");
      return value;
    }
  }
  return undefined;
}

/**
 * Evaluates HTTP preconditions per RFC 9110 section 13.2.2.
 *
 * @param req - The request with method and headers (header names case-insensitive, array values joined with ', ').
 * @param current - The current resource state: etag (entity tag string), lastModified (Date), exists (default true).
 * @returns An object with status (200, 304, 412), reason, and warnings for ignored or malformed headers.
 */
export function evaluatePreconditions(
  req: { method: string; headers: Record<string, string | string[] | undefined> },
  current: { etag?: string; lastModified?: Date; exists?: boolean },
): PreconditionResult {
  const warnings: string[] = [];
  const method = req.method;
  const headers = req.headers;
  const etag = current.etag;
  const lastModified = current.lastModified;
  const exists = current.exists === undefined ? true : current.exists;

  let currentEtag: EntityTag | undefined;
  if (etag !== undefined) {
    try {
      const parsed = parseEntityTags(etag);
      if (Array.isArray(parsed) && parsed.length === 1) {
        currentEtag = parsed[0];
      }
    } catch {
      currentEtag = undefined;
    }
  }

  // Step 1: If-Match
  const ifMatchRaw = getHeader(headers, "if-match");
  if (ifMatchRaw !== undefined) {
    let ifMatchTags: EntityTag[] | "*";
    try {
      ifMatchTags = parseEntityTags(ifMatchRaw);
    } catch (e) {
      if (e instanceof EtagError) {
        warnings.push("malformed_if_match");
        return { status: 412, reason: "if_match_failed", warnings };
      }
      throw e;
    }
    let match = false;
    if (ifMatchTags === "*") {
      match = exists;
    } else {
      const strongCurrent =
        currentEtag !== undefined && !currentEtag.weak ? currentEtag : undefined;
      if (strongCurrent !== undefined) {
        match = ifMatchTags.some((tag) => !tag.weak && tag.opaque === strongCurrent.opaque);
      }
    }
    if (!match) {
      return { status: 412, reason: "if_match_failed", warnings };
    }
  }

  // Step 2: If-Unmodified-Since (only when If-Match is absent)
  const ifUnmodRaw =
    ifMatchRaw === undefined ? getHeader(headers, "if-unmodified-since") : undefined;
  if (ifUnmodRaw !== undefined) {
    const date = parseHttpDate(ifUnmodRaw);
    if (date === null) {
      warnings.push("invalid_if_unmodified_since");
    } else if (lastModified !== undefined) {
      const lastModifiedSec = Math.floor(lastModified.getTime() / 1000);
      const dateSec = Math.floor(date.getTime() / 1000);
      if (lastModifiedSec > dateSec) {
        return { status: 412, reason: "if_unmodified_since_failed", warnings };
      }
    }
  }

  // Step 3: If-None-Match
  const ifNoneRaw = getHeader(headers, "if-none-match");
  if (ifNoneRaw !== undefined) {
    let ifNoneTags: EntityTag[] | "*";
    try {
      ifNoneTags = parseEntityTags(ifNoneRaw);
    } catch (e) {
      if (e instanceof EtagError) {
        warnings.push("malformed_if_none_match");
        return { status: 200, reason: "proceed", warnings };
      }
      throw e;
    }
    let match = false;
    if (ifNoneTags === "*") {
      match = exists;
    } else {
      const knownCurrent = currentEtag;
      if (knownCurrent !== undefined) {
        match = ifNoneTags.some((tag) => tag.opaque === knownCurrent.opaque);
      }
    }
    if (match) {
      const status = method === "GET" || method === "HEAD" ? 304 : 412;
      return { status, reason: "if_none_match_matched", warnings };
    }
    return { status: 200, reason: "proceed", warnings };
  }

  // Step 4: If-Modified-Since (only GET/HEAD, no If-None-Match)
  if (method === "GET" || method === "HEAD") {
    const ifModRaw = getHeader(headers, "if-modified-since");
    if (ifModRaw !== undefined) {
      const date = parseHttpDate(ifModRaw);
      if (date === null) {
        warnings.push("invalid_if_modified_since");
      } else if (lastModified !== undefined) {
        const lastModifiedSec = Math.floor(lastModified.getTime() / 1000);
        const dateSec = Math.floor(date.getTime() / 1000);
        if (lastModifiedSec <= dateSec) {
          return { status: 304, reason: "if_modified_since_not_modified", warnings };
        }
      }
    }
  }

  return { status: 200, reason: "proceed", warnings };
}

/**
 * Formats a Date as an IMF-fixdate per RFC 9110 section 5.6.7, always in GMT.
 *
 * @param d - The Date to format.
 * @returns The formatted HTTP date string.
 */
export function formatHttpDate(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const day = days[d.getUTCDay()];
  const date = d.getUTCDate().toString().padStart(2, "0");
  const month = months[d.getUTCMonth()];
  const year = d.getUTCFullYear().toString().padStart(4, "0");
  const hours = d.getUTCHours().toString().padStart(2, "0");
  const minutes = d.getUTCMinutes().toString().padStart(2, "0");
  const seconds = d.getUTCSeconds().toString().padStart(2, "0");
  return `${day}, ${date} ${month} ${year} ${hours}:${minutes}:${seconds} GMT`;
}

/**
 * Parses an HTTP date per RFC 9110 section 5.6.7: IMF-fixdate, obsolete RFC 850, or asctime.
 *
 * @param value - The header value to parse.
 * @param opts - Options, currently only `now` (Date) used for two-digit year interpretation.
 * @returns The parsed Date as UTC, or null if invalid or longer than 64 characters.
 */
export function parseHttpDate(value: string, opts?: { now?: Date }): Date | null {
  if (value.length > 64) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === "") return null;

  const now = opts?.now ?? new Date();

  // IMF-fixdate: Sun, 06 Nov 1994 08:49:37 GMT
  const imfRegex = /^([A-Za-z]{3}), (\d{2}) ([A-Za-z]{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/;
  const imfMatch = trimmed.match(imfRegex);
  if (imfMatch) {
    const dayName = imfMatch[1] ?? "";
    const day = Number(imfMatch[2]);
    const month = parseMonth(imfMatch[3] ?? "");
    const year = Number(imfMatch[4]);
    const hour = Number(imfMatch[5]);
    const min = Number(imfMatch[6]);
    const sec = Number(imfMatch[7]);
    if (
      !isValidDayName(dayName) ||
      month === undefined ||
      day < 1 ||
      day > 31 ||
      hour > 23 ||
      min > 59 ||
      sec > 59
    ) {
      return null;
    }
    return new Date(Date.UTC(year, month, day, hour, min, sec));
  }

  // RFC850: Sunday, 06-Nov-94 08:49:37 GMT
  const rfc850Regex =
    /^([A-Za-z]{6,9}), (\d{2})-([A-Za-z]{3})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/;
  const rfc850Match = trimmed.match(rfc850Regex);
  if (rfc850Match) {
    const dayName = rfc850Match[1] ?? "";
    const day = Number(rfc850Match[2]);
    const month = parseMonth(rfc850Match[3] ?? "");
    const year2 = Number(rfc850Match[4]);
    const hour = Number(rfc850Match[5]);
    const min = Number(rfc850Match[6]);
    const sec = Number(rfc850Match[7]);
    if (
      !isValidDayNameLong(dayName) ||
      month === undefined ||
      day < 1 ||
      day > 31 ||
      hour > 23 ||
      min > 59 ||
      sec > 59
    ) {
      return null;
    }
    const year = getFullYearFrom2Digit(year2, now);
    return new Date(Date.UTC(year, month, day, hour, min, sec));
  }

  // asctime: Sun Nov  6 08:49:37 1994
  const asctimeRegex = /^([A-Za-z]{3}) ([A-Za-z]{3}) +(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/;
  const asctimeMatch = trimmed.match(asctimeRegex);
  if (asctimeMatch) {
    const dayName = asctimeMatch[1] ?? "";
    const month = parseMonth(asctimeMatch[2] ?? "");
    const day = Number(asctimeMatch[3]);
    const hour = Number(asctimeMatch[4]);
    const min = Number(asctimeMatch[5]);
    const sec = Number(asctimeMatch[6]);
    const year = Number(asctimeMatch[7]);
    if (
      !isValidDayName(dayName) ||
      month === undefined ||
      day < 1 ||
      day > 31 ||
      hour > 23 ||
      min > 59 ||
      sec > 59
    ) {
      return null;
    }
    return new Date(Date.UTC(year, month, day, hour, min, sec));
  }

  return null;
}

function parseMonth(monthStr: string): number | undefined {
  const months: Record<string, number> = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  };
  return months[monthStr];
}

function isValidDayName(dayName: string): boolean {
  const shortDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return shortDays.includes(dayName);
}

function isValidDayNameLong(dayName: string): boolean {
  const longDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return longDays.includes(dayName);
}

function getFullYearFrom2Digit(year2: number, now: Date): number {
  const currentYear = now.getUTCFullYear();
  const currentCentury = Math.floor(currentYear / 100) * 100;
  let year = currentCentury + year2;
  if (year > currentYear + 50) {
    year -= 100;
  }
  return year;
}

/**
 * Builds response headers for a 304 Not Modified response per RFC 9110 section 15.4.5.
 *
 * @param current - The current resource state: etag and/or lastModified.
 * @param extra - Additional headers to copy if they are Cache-Control, Content-Location, Date, Expires, or Vary.
 * @returns An object with ETag, Last-Modified (if present) and the allowed extra headers (case preserved).
 */
export function notModifiedHeaders(
  current: { etag?: string; lastModified?: Date },
  extra?: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (current.etag !== undefined) {
    result.ETag = current.etag;
  }
  if (current.lastModified !== undefined) {
    result["Last-Modified"] = formatHttpDate(current.lastModified);
  }
  if (extra) {
    const allowedHeaders = new Set([
      "cache-control",
      "content-location",
      "date",
      "expires",
      "vary",
    ]);
    for (const [key, value] of Object.entries(extra)) {
      if (allowedHeaders.has(key.toLowerCase())) {
        result[key] = value;
      }
    }
  }
  return result;
}
