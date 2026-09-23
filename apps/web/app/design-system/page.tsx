"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Activity, AlertTriangle, ChevronDown, CircleHelp, LoaderCircle, Radio, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const buttonVariants = ["default", "outline", "secondary", "destructive", "ghost", "green", "yellow", "red", "purple"] as const;
const badgeVariants = ["default", "outline", "secondary", "destructive", "ghost", "green", "yellow", "red", "purple"] as const;

function ShowcaseSection({ title, description, children }: Readonly<{ title: string; description: string; children: ReactNode }>) {
  return (
    <section aria-labelledby={title} className="space-y-3">
      <div>
        <h2 id={title} className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

export default function DesignSystemPage() {
  const [showLoading, setShowLoading] = useState(false);

  return (
    <TooltipProvider>
      <div className="mx-auto max-w-6xl space-y-10 pb-10">
        <header className="space-y-3 border-b-[1.5px] border-border pb-6">
          <Badge variant="outline">Private route</Badge>
          <h1 className="text-3xl font-bold tracking-tight">PitWall ML component showcase</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            A live harness for the existing shared primitives and truthful container states. It is intentionally unlinked from product navigation.
          </p>
        </header>

        <ShowcaseSection title="Buttons" description="Hover, keyboard focus, native press, and disabled behavior are exercised with the shipped Button primitive.">
          <Card>
            <CardContent className="flex flex-wrap gap-3 pt-6">
              {buttonVariants.map((variant) => <Button key={variant} variant={variant}>{variant}</Button>)}
              <Button disabled><X />Unavailable</Button>
              <Tooltip>
                <TooltipTrigger asChild><Button size="icon" variant="outline" aria-label="Open control guidance"><CircleHelp /></Button></TooltipTrigger>
                <TooltipContent>Keyboard focus exposes the shared ring.</TooltipContent>
              </Tooltip>
            </CardContent>
          </Card>
        </ShowcaseSection>

        <ShowcaseSection title="Badges and depth" description="Semantic labels sit on bordered dark surfaces; they do not claim live race data.">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Badge variants</CardTitle><CardDescription>Existing palette and shape lock.</CardDescription></CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {badgeVariants.map((variant) => <Badge key={variant} variant={variant}>{variant}</Badge>)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Overlay primitives</CardTitle><CardDescription>Menu and dialog use their actual Radix-backed surfaces.</CardDescription></CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="outline">Open menu <ChevronDown /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuLabel>Harness actions</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem>Inspect default state</DropdownMenuItem>
                    <DropdownMenuItem disabled>Unavailable item</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Dialog>
                  <DialogTrigger asChild><Button variant="secondary">Open dialog</Button></DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Shared dialog surface</DialogTitle><DialogDescription>This is a component interaction, not a race-event notification.</DialogDescription></DialogHeader>
                    <DialogFooter><Button>Confirm example</Button></DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>
          </div>
        </ShowcaseSection>

        <ShowcaseSection title="Tabs and containers" description="Data containers state their source condition directly instead of substituting placeholder race records.">
          <Card>
            <CardContent className="pt-6">
              <Tabs defaultValue="loading">
                <TabsList aria-label="Container state examples">
                  <TabsTrigger value="loading">Loading</TabsTrigger>
                  <TabsTrigger value="empty">Empty</TabsTrigger>
                  <TabsTrigger value="error">Error</TabsTrigger>
                  <TabsTrigger disabled value="disabled">Disabled</TabsTrigger>
                </TabsList>
                <TabsContent value="loading" className="rounded-lg border-[1.5px] border-border bg-secondary/40 p-4 text-sm">
                  <div className="flex items-center gap-2 text-pitwall-cyan"><LoaderCircle className={showLoading ? "animate-spin motion-reduce:animate-none" : ""} />No request is pending in this harness.</div>
                  <Button className="mt-3" size="sm" variant="outline" onClick={() => setShowLoading((current) => !current)}>{showLoading ? "Stop motion" : "Preview loading motion"}</Button>
                </TabsContent>
                <TabsContent value="empty" className="rounded-lg border-[1.5px] border-border bg-secondary/40 p-4 text-sm text-muted-foreground">No records are loaded into this private showcase.</TabsContent>
                <TabsContent value="error" className="rounded-lg border-[1.5px] border-destructive/60 bg-destructive/15 p-4 text-sm text-pitwall-rose"><AlertTriangle className="mr-2 inline size-4" />No fetch was attempted. This is the documented error container treatment.</TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </ShowcaseSection>

        <ShowcaseSection title="Table, selection, and separator" description="The Table primitive owns local overflow so route-level content can remain readable at narrow widths.">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground"><Activity className="size-4 text-pitwall-cyan" />Static component state inventory</div>
              <Separator />
              <Table>
                <TableCaption>State examples only; values are descriptive labels rather than telemetry.</TableCaption>
                <TableHeader><TableRow><TableHead>Container</TableHead><TableHead>Visible state</TableHead><TableHead>Interaction</TableHead></TableRow></TableHeader>
                <TableBody>
                  <TableRow><TableCell>Default row</TableCell><TableCell><Badge variant="outline">Ready</Badge></TableCell><TableCell>Hover or focus nearby controls</TableCell></TableRow>
                  <TableRow data-state="selected"><TableCell>Selected row</TableCell><TableCell><Badge variant="default">Selected</Badge></TableCell><TableCell>Selection tint</TableCell></TableRow>
                  <TableRow><TableCell>Loading state</TableCell><TableCell><Badge variant="yellow">Harness</Badge></TableCell><TableCell>Explicit status copy</TableCell></TableRow>
                </TableBody>
              </Table>
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Radio className="size-3 text-pitwall-cyan" />No live connection is represented on this page.</div>
            </CardContent>
          </Card>
        </ShowcaseSection>
      </div>
    </TooltipProvider>
  );
}
