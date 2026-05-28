export function deriveSiteSlug(siteUrl) {
  let host = "";
  try {
    host = new URL(siteUrl).host;
  } catch {
    host = siteUrl;
  }

  host = host.toLowerCase().trim();
  if (host.includes("@")) {
    host = host.split("@").at(-1);
  }
  if (host.includes(":")) {
    host = host.split(":")[0];
  }
  if (host.startsWith("www.")) {
    host = host.slice(4);
  }

  const slug = host.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "site";
}
