import { SiteNav } from "@/components/SiteNav";

export default function JobsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <SiteNav active="market" />
      {children}
    </>
  );
}
