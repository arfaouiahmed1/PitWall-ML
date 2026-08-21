/** @type {import('next').NextConfig} */
const isExport =
  process.env.STATIC_EXPORT === "true" ||
  process.env.GITHUB_PAGES === "true";

// Derive basePath for GitHub Pages project sites: https://<user>.github.io/<repo>/
// Override manually with NEXT_PUBLIC_BASE_PATH if you use a custom domain or user site.
const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "";
const isUserSite = repoName.endsWith(".github.io");
const derivedBasePath =
  isUserSite || !repoName ? "" : `/${repoName}`;
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? (isExport ? derivedBasePath : "");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: isExport ? "export" : undefined,
  // GitHub Pages serves static export from /out with no image optimizer
  images: isExport ? { unoptimized: true } : undefined,
  // Required for project pages (e.g. /PitWall-ML); empty for custom domain / user site
  basePath: basePath || undefined,
  assetPrefix: basePath ? `${basePath}/` : undefined,
  trailingSlash: isExport ? true : undefined,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  // Expose commit info to client for dashboard footer
  env: {
    NEXT_PUBLIC_GIT_SHA: process.env.GITHUB_SHA?.slice(0, 7) ?? "",
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

module.exports = nextConfig;
