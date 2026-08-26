import { SiteNav } from "@/components/SiteNav";
export default function WorkersLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (<><SiteNav active="market" />{children}</>);
}
