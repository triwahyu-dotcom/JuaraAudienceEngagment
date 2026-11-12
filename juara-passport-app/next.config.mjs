/** Aplikasi diekspor sebagai halaman statis (folder out/) supaya bisa di-host gratis tanpa server. */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
};
export default nextConfig;
