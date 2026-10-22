// Adapted from ReUI registry component @reui/c-sidebar-1 (base-nova).
import type { ReactNode } from "react";
import { Link } from "react-router";
import { ActivityIcon, CompassIcon, PlusIcon, WalletIcon } from "lucide-react";
import { reownButtonLabel, type ReownStatus } from "@/reown-status";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ROUTES } from "@/routing";

type AppNavRoute = "market" | "create-demand" | "my-activity";

type ReuiAppShellProps = {
  children: ReactNode;
  activeRoute: AppNavRoute;
  pageTitle: string;
  account: string | null;
  walletStatus: ReownStatus;
  busy: boolean;
  boardLoading: boolean;
  onConnect: () => void;
  onRefresh: () => void;
};

const NAV = [
  { id: "market", label: "Explore Market", href: ROUTES.market.href, icon: <CompassIcon aria-hidden="true" /> },
  { id: "create-demand", label: "Create Demand", href: ROUTES.createDemand.href, icon: <PlusIcon aria-hidden="true" /> },
  { id: "my-activity", label: "My Activity", href: ROUTES.myActivity.href, icon: <ActivityIcon aria-hidden="true" /> },
] as const;

function BrandHeader() {
  const { setOpenMobile } = useSidebar();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          render={<Link to={ROUTES.landing.href} />}
          onClick={() => setOpenMobile(false)}
          aria-label="UNMET"
        >
          <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-transparent">
            <img
              src="/logos/unmet.png"
              alt=""
              width={32}
              height={32}
              className="size-8 shrink-0 object-contain"
            />
          </span>
          <span className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-medium">unmet</span>
          </span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function WorkspaceNav({ activeRoute }: { activeRoute: AppNavRoute }) {
  const { setOpenMobile } = useSidebar();

  return (
    <SidebarGroup className="gap-1">
      <SidebarGroupContent>
        <SidebarMenu className="gap-2">
          {NAV.map((item) => (
            <SidebarMenuItem key={item.id}>
              <SidebarMenuButton
                size="lg"
                className="gap-3"
                tooltip={item.label}
                aria-label={item.label}
                render={<Link to={item.href} />}
                isActive={activeRoute === item.id}
                aria-current={activeRoute === item.id ? "page" : undefined}
                onClick={() => setOpenMobile(false)}
              >
                {item.icon}
                <span className="group-data-[collapsible=icon]:hidden">{item.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function WalletControl({
  account,
  walletStatus,
  busy,
  onConnect,
}: Pick<ReuiAppShellProps, "account" | "walletStatus" | "busy" | "onConnect">) {
  const walletReady = walletStatus === "ready";
  const walletLabel = reownButtonLabel(walletStatus, account ? short(account) : undefined);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          onClick={walletReady && !busy ? onConnect : undefined}
          disabled={busy || !walletReady}
          tooltip={walletReady ? walletLabel : undefined}
          aria-label={walletLabel}
        >
          <WalletIcon aria-hidden="true" />
          <span className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-medium">{walletLabel}</span>
          </span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function Workbench({
  children,
  pageTitle,
  boardLoading,
  busy,
  onRefresh,
}: Pick<ReuiAppShellProps, "children" | "pageTitle" | "boardLoading" | "busy" | "onRefresh">) {
  return (
    <SidebarInset className="min-w-0 overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger className="-ml-1" />
        <Breadcrumb className="min-w-0">
          <BreadcrumbList className="flex-nowrap">
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbLink render={<Link to={ROUTES.landing.href} />} className="truncate">
                UNMET
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{pageTitle}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={onRefresh}
          disabled={busy || boardLoading}
        >
          {boardLoading ? "Updating" : "Refresh"}
        </Button>
      </header>

      <div className="flex-1 overflow-auto p-4">{children}</div>
    </SidebarInset>
  );
}

export function ReuiAppShell(props: ReuiAppShellProps) {
  const { children, activeRoute, account, walletStatus, busy, boardLoading, onConnect, onRefresh } = props;

  return (
    <TooltipProvider>
      <SidebarProvider className="relative h-dvh min-h-0 w-full overflow-hidden">
        <Sidebar variant="inset" collapsible="icon" className="absolute h-full">
          <SidebarHeader>
            <BrandHeader />
          </SidebarHeader>

          <SidebarContent role="navigation" aria-label="Market">
            <WorkspaceNav activeRoute={activeRoute} />
          </SidebarContent>

          <SidebarFooter>
            <SidebarSeparator className="mx-0" />
            <WalletControl
              account={account}
              walletStatus={walletStatus}
              busy={busy}
              onConnect={onConnect}
            />
          </SidebarFooter>
        </Sidebar>

        <Workbench
          pageTitle={props.pageTitle}
          boardLoading={boardLoading}
          busy={busy}
          onRefresh={onRefresh}
        >
          {children}
        </Workbench>
      </SidebarProvider>
    </TooltipProvider>
  );
}

function short(value: string): string {
  return value.slice(0, 6) + "…" + value.slice(-4);
}
