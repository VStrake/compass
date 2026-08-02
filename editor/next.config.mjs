/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // editor/ is a self-contained app inside a larger repo; pin the workspace
  // root so the sibling project's lockfile is not mistaken for ours.
  turbopack: { root: import.meta.dirname },
  // three ships untranspiled ESM (incl. three/examples/jsm/*); let Next compile it.
  transpilePackages: ['three'],
};

export default nextConfig;
