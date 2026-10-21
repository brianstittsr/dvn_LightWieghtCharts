import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "10.168.168.62", "localhost"],
  serverExternalPackages: ["ffmpeg-static"],
};

export default nextConfig;
