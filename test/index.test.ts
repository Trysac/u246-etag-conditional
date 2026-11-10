import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  computeEtag,
  EtagError,
  evaluatePreconditions,
  formatHttpDate,
  notModifiedHeaders,
  parseEntityTags,
  parseHttpDate,
} from "../src/index.js";

describe("computeEtag", () => {
  it("hashes string as UTF-8 and returns strong etag", () => {
    expect(computeEtag("hello")).toBe('"LPJNul-wow4m6Dsqxbning"');
  });

  it("supports weak etags", () => {
    expect(computeEtag("", { weak: true })).toBe('W/"47DEQpj8HBSa-_TImW-5JA"');
  });

  it("hashes Uint8Array correctly", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const hash = createHash("sha256").update(bytes).digest().subarray(0, 16).toString("base64url");
    expect(computeEtag(bytes)).toBe(`"${hash}"`);
  });

  it("defaults to strong etag when no opts", () => {
    expect(computeEtag("test")).toBe(computeEtag("test", {}));
  });
});

describe("parseEntityTags", () => {
  it("parses comma-separated tags with optional whitespace", () => {
    expect(parseEntityTags('"a", W/"b"')).toEqual([
      { weak: false, opaque: "a" },
      { weak: true, opaque: "b" },
    ]);
  });

  it("returns '*' for wildcard", () => {
    expect(parseEntityTags("*")).toBe("*");
    expect(parseEntityTags("   *   ")).toBe("*");
  });

  it("throws malformed for unclosed quote", () => {
    expect(() => parseEntityTags('"a')).toThrow(EtagError);
    try {
      parseEntityTags('"a');
    } catch (e) {
      expect(e).toBeInstanceOf(EtagError);
      expect((e as EtagError).code).toBe("malformed_etag");
    }
  });

  it("throws malformed for empty or only commas", () => {
    expect(() => parseEntityTags("")).toThrow(EtagError);
    expect(() => parseEntityTags(" , , ")).toThrow(EtagError);
  });

  it("throws header_too_large for long value", () => {
    const long = "a".repeat(8193);
    expect(() => parseEntityTags(long)).toThrow(EtagError);
    try {
      parseEntityTags(long);
    } catch (e) {
      expect((e as EtagError).code).toBe("header_too_large");
    }
  });

  it("throws header_too_large for more than 100 tags", () => {
    const tags = Array(101).fill('"a"').join(", ");
    expect(() => parseEntityTags(tags)).toThrow(EtagError);
    try {
      parseEntityTags(tags);
    } catch (e) {
      expect((e as EtagError).code).toBe("header_too_large");
    }
  });

  it("keeps commas inside an opaque tag instead of splitting on them", () => {
    expect(parseEntityTags('"a,b"')).toEqual([{ weak: false, opaque: "a,b" }]);
    expect(parseEntityTags('"a,b", W/"c,d"')).toEqual([
      { weak: false, opaque: "a,b" },
      { weak: true, opaque: "c,d" },
    ]);
  });

  it("allows obs-text inside tags", () => {
    const tag = '"\x80"';
    const result = parseEntityTags(tag);
    expect(Array.isArray(result)).toBe(true);
    if (Array.isArray(result)) {
      expect(result).toEqual([{ weak: false, opaque: "\x80" }]);
    }
  });

  it("skip empty members", () => {
    expect(parseEntityTags(' "a", , W/"b" ')).toEqual([
      { weak: false, opaque: "a" },
      { weak: true, opaque: "b" },
    ]);
  });

  it("throws for invalid tags", () => {
    expect(() => parseEntityTags("abc")).toThrow(EtagError);
    expect(() => parseEntityTags('"a b"')).toThrow(EtagError);
    expect(() => parseEntityTags('W/"')).toThrow(EtagError);
  });
});

describe("formatHttpDate / parseHttpDate", () => {
  const timestamp = 784111777000; // 1994-11-06T08:49:37Z
  const date = new Date(timestamp);

  it("formats correctly", () => {
    expect(formatHttpDate(date)).toBe("Sun, 06 Nov 1994 08:49:37 GMT");
  });

  it("parses IMF-fixdate", () => {
    const parsed = parseHttpDate("Sun, 06 Nov 1994 08:49:37 GMT");
    expect(parsed?.getTime()).toBe(timestamp);
  });

  it("parses RFC 850 format", () => {
    const parsed = parseHttpDate("Sunday, 06-Nov-94 08:49:37 GMT");
    expect(parsed?.getTime()).toBe(timestamp);
  });

  it("parses asctime format", () => {
    const parsed = parseHttpDate("Sun Nov  6 08:49:37 1994");
    expect(parsed?.getTime()).toBe(timestamp);
  });

  it("returns null for invalid values", () => {
    expect(parseHttpDate("invalid")).toBeNull();
    expect(parseHttpDate("a".repeat(65))).toBeNull();
    expect(parseHttpDate("Sun, 06 Nov 1994 08:49:37")).toBeNull();
  });

  it("handles two-digit year rule", () => {
    const now = new Date("2024-01-01T00:00:00Z");
    expect(parseHttpDate("Sunday, 06-Nov-75 08:49:37 GMT", { now })?.getUTCFullYear()).toBe(1975);
    expect(parseHttpDate("Sunday, 06-Nov-30 08:49:37 GMT", { now })?.getUTCFullYear()).toBe(2030);
  });

  it("rejects invalid components", () => {
    expect(parseHttpDate("Funday, 06-Nov-94 08:49:37 GMT")).toBeNull();
    expect(parseHttpDate("Sun, 06 Xxx 1994 08:49:37 GMT")).toBeNull();
    expect(parseHttpDate("Sun, 06 Nov 1994 24:00:00 GMT")).toBeNull();
  });
});

describe("evaluatePreconditions", () => {
  const baseReq = (method = "GET", headers: Record<string, string | string[]> = {}) => ({
    method,
    headers,
  });

  it("acceptance: GET with If-None-Match weak match returns 304", () => {
    const req = baseReq("GET", { "if-none-match": 'W/"a", "b"' });
    const current = { etag: '"a"' };
    expect(evaluatePreconditions(req, current)).toEqual({
      status: 304,
      reason: "if_none_match_matched",
      warnings: [],
    });
  });

  it("acceptance: PUT with If-None-Match weak match returns 412", () => {
    const req = baseReq("PUT", { "if-none-match": 'W/"a", "b"' });
    const current = { etag: '"a"' };
    expect(evaluatePreconditions(req, current)).toEqual({
      status: 412,
      reason: "if_none_match_matched",
      warnings: [],
    });
  });

  it("acceptance: If-Match weak against strong fails (412)", () => {
    const req = baseReq("GET", { "if-match": 'W/"a"' });
    const current = { etag: '"a"' };
    expect(evaluatePreconditions(req, current)).toEqual({
      status: 412,
      reason: "if_match_failed",
      warnings: [],
    });
  });

  it("acceptance: If-Match strong match proceeds", () => {
    const req = baseReq("GET", { "if-match": '"a"' });
    const current = { etag: '"a"' };
    expect(evaluatePreconditions(req, current)).toEqual({
      status: 200,
      reason: "proceed",
      warnings: [],
    });
  });

  it("acceptance: If-Match '*' with exists false returns 412", () => {
    const req = baseReq("GET", { "if-match": "*" });
    const current = { exists: false };
    expect(evaluatePreconditions(req, current)).toEqual({
      status: 412,
      reason: "if_match_failed",
      warnings: [],
    });
  });

  it("acceptance: If-None-Match non-matching ignores If-Modified-Since", () => {
    const req = baseReq("GET", {
      "if-none-match": '"x"',
      "if-modified-since": "Sun, 06 Nov 1994 08:49:37 GMT",
    });
    const current = {
      etag: '"a"',
      lastModified: new Date("1994-11-06T08:49:38Z"), // later than date
    };
    expect(evaluatePreconditions(req, current)).toEqual({
      status: 200,
      reason: "proceed",
      warnings: [],
    });
  });

  it("acceptance: matching If-Match ignores If-Unmodified-Since", () => {
    const req = baseReq("GET", {
      "if-match": '"a"',
      "if-unmodified-since": "Sun, 06 Nov 1994 08:49:37 GMT",
    });
    const current = {
      etag: '"a"',
      lastModified: new Date("1994-11-06T08:49:38Z"), // later than date
    };
    expect(evaluatePreconditions(req, current)).toEqual({
      status: 200,
      reason: "proceed",
      warnings: [],
    });
  });

  it("acceptance: If-Modified-Since with second precision", () => {
    const req = baseReq("GET", { "if-modified-since": "Sun, 06 Nov 1994 08:49:37 GMT" });
    const current = { lastModified: new Date("1994-11-06T08:49:37.900Z") };
    expect(evaluatePreconditions(req, current)).toEqual({
      status: 304,
      reason: "if_modified_since_not_modified",
      warnings: [],
    });
  });

  it("acceptance: If-Modified-Since with later lastModified returns 200", () => {
    const req = baseReq("GET", { "if-modified-since": "Sun, 06 Nov 1994 08:49:37 GMT" });
    const current = { lastModified: new Date("1994-11-06T08:49:38Z") };
    expect(evaluatePreconditions(req, current)).toEqual({
      status: 200,
      reason: "proceed",
      warnings: [],
    });
  });

  it("acceptance: POST ignores If-Modified-Since", () => {
    const req = baseReq("POST", { "if-modified-since": "Sun, 06 Nov 1994 08:49:37 GMT" });
    const current = { lastModified: new Date("1994-11-06T08:49:37Z") };
    expect(evaluatePreconditions(req, current)).toEqual({
      status: 200,
      reason: "proceed",
      warnings: [],
    });
  });

  it("acceptance: invalid If-Modified-Since is ignored with warning", () => {
    const req = baseReq("GET", { "if-modified-since": "yesterday" });
    const current = { lastModified: new Date("1994-11-06T08:49:37Z") };
    expect(evaluatePreconditions(req, current)).toEqual({
      status: 200,
      reason: "proceed",
      warnings: ["invalid_if_modified_since"],
    });
  });

  it("edge: current.etag undefined, If-Match fails, If-None-Match does not match", () => {
    expect(evaluatePreconditions(baseReq("GET", { "if-match": '"a"' }), {})).toEqual({
      status: 412,
      reason: "if_match_failed",
      warnings: [],
    });
    expect(evaluatePreconditions(baseReq("GET", { "if-none-match": '"a"' }), {})).toEqual({
      status: 200,
      reason: "proceed",
      warnings: [],
    });
  });

  it("edge: current etag containing a comma matches If-Match strongly", () => {
    const req = baseReq("PUT", { "if-match": '"a,b"' });
    const current = { etag: '"a,b"' };
    expect(evaluatePreconditions(req, current)).toEqual({
      status: 200,
      reason: "proceed",
      warnings: [],
    });
    expect(evaluatePreconditions(baseReq("GET", { "if-none-match": '"a,b"' }), current)).toEqual({
      status: 304,
      reason: "if_none_match_matched",
      warnings: [],
    });
  });

  it("edge: HEAD behaves like GET for If-None-Match match", () => {
    const req = baseReq("HEAD", { "if-none-match": '"a"' });
    const current = { etag: '"a"' };
    expect(evaluatePreconditions(req, current)).toEqual({
      status: 304,
      reason: "if_none_match_matched",
      warnings: [],
    });
  });

  it("edge: weak current etag matches If-None-Match weakly", () => {
    const req = baseReq("GET", { "if-none-match": '"a"' });
    const current = { etag: 'W/"a"' };
    expect(evaluatePreconditions(req, current)).toEqual({
      status: 304,
      reason: "if_none_match_matched",
      warnings: [],
    });
  });

  it("edge: malformed If-Match gives 412 with warning", () => {
    const req = baseReq("GET", { "if-match": '"a' });
    const current = { etag: '"a"' };
    expect(evaluatePreconditions(req, current)).toEqual({
      status: 412,
      reason: "if_match_failed",
      warnings: ["malformed_if_match"],
    });
  });

  it("edge: malformed If-None-Match gives 200 with warning", () => {
    const req = baseReq("GET", { "if-none-match": '"a' });
    const current = { etag: '"a"' };
    expect(evaluatePreconditions(req, current)).toEqual({
      status: 200,
      reason: "proceed",
      warnings: ["malformed_if_none_match"],
    });
  });

  it("edge: header too large in If-Match gives 412 with malformed warning", () => {
    const long = "a".repeat(8193);
    const req = baseReq("GET", { "if-match": long });
    const current = { etag: '"a"' };
    expect(evaluatePreconditions(req, current)).toEqual({
      status: 412,
      reason: "if_match_failed",
      warnings: ["malformed_if_match"],
    });
  });

  it("edge: header too large in If-None-Match gives 200 with malformed warning", () => {
    const long = "a".repeat(8193);
    const req = baseReq("GET", { "if-none-match": long });
    const current = { etag: '"a"' };
    expect(evaluatePreconditions(req, current)).toEqual({
      status: 200,
      reason: "proceed",
      warnings: ["malformed_if_none_match"],
    });
  });

  it("handles array header values joined with comma space", () => {
    const req = baseReq("GET", { "if-match": ['"a"', '"b"'] });
    const current = { etag: '"a"' };
    expect(evaluatePreconditions(req, current)).toEqual({
      status: 200,
      reason: "proceed",
      warnings: [],
    });
  });

  it("invalid If-Unmodified-Since ignored with warning", () => {
    const req = baseReq("GET", { "if-unmodified-since": "invalid" });
    const current = { lastModified: new Date("1994-11-06T08:49:38Z") };
    expect(evaluatePreconditions(req, current)).toEqual({
      status: 200,
      reason: "proceed",
      warnings: ["invalid_if_unmodified_since"],
    });
  });
});

describe("notModifiedHeaders", () => {
  it("includes ETag and Last-Modified from current, copies allowed extra headers", () => {
    const headers = notModifiedHeaders(
      { etag: '"a"', lastModified: new Date(784111777000) },
      { "Cache-Control": "no-cache", "Content-Type": "application/json" },
    );
    expect(headers).toEqual({
      ETag: '"a"',
      "Last-Modified": "Sun, 06 Nov 1994 08:49:37 GMT",
      "Cache-Control": "no-cache",
    });
  });

  it("handles different casing in extra", () => {
    const headers = notModifiedHeaders({}, { EXPIRES: "0", "X-Custom": "x" });
    expect(headers).toEqual({ EXPIRES: "0" });
  });

  it("returns only provided fields", () => {
    expect(notModifiedHeaders({ etag: '"a"' })).toEqual({ ETag: '"a"' });
    expect(notModifiedHeaders({ lastModified: new Date(784111777000) })).toEqual({
      "Last-Modified": "Sun, 06 Nov 1994 08:49:37 GMT",
    });
  });
});
