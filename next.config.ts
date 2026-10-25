import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist resolves its worker and standard-font data relative to its own
  // package directory, and bundling rewrites those paths out from under it, so
  // the upload pipeline's text extraction only works with it left external.
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
