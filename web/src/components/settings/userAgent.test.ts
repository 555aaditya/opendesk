import { describe, expect, it } from "vitest";
import { describeUserAgent } from "./userAgent";

describe("describeUserAgent", () => {
  it("names browser and OS", () => {
    expect(
      describeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36").label,
    ).toBe("Chrome on macOS");
    expect(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1")).toEqual({
      label: "Safari on iOS",
      mobile: true,
    });
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0").label).toBe("Firefox on Windows");
    expect(describeUserAgent("").label).toBe("Browser");
  });
});
