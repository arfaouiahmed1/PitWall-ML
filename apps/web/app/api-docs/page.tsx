"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, ExternalLink, RefreshCw, Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { API_URL } from "@/lib/api";
import { OPENAPI_PROVENANCE, OPENAPI_SNAPSHOT, getOpenApiEndpoints, getOpenApiSchemas, getOpenApiTags } from "@/lib/openapi";

type Status = "CONNECTING" | "ONLINE" | "OFFLINE" | "MIXED CONTENT";

const methodStyle: Record<string, string> = {
  GET: "text-pitwall-cyan border-pitwall-cyan/40",
  POST: "text-pitwall-green border-pitwall-green/40",
};

export default function ApiDocsPage() {
  const apiUrl = useMemo(() => (API_URL || "http://localhost:8000").replace(/\/$/, ""), []);
  const docsUrl = `${apiUrl}/docs`;
  const specUrl = `${apiUrl}/openapi.json`;
  const [status, setStatus] = useState<Status>("CONNECTING");
  const [iframeKey, setIframeKey] = useState(0);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("ALL");

  const probe = useCallback(async () => {
    const mixedContent = window.location.protocol === "https:" && apiUrl.startsWith("http:");
    if (mixedContent) return setStatus("MIXED CONTENT");
    setStatus("CONNECTING");
    try {
      const response = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(3000) });
      setStatus(response.ok ? "ONLINE" : "OFFLINE");
    } catch {
      setStatus("OFFLINE");
    }
  }, [apiUrl]);

  useEffect(() => { void probe(); }, [probe]);

  const download = useCallback(async () => {
    let data = OPENAPI_SNAPSHOT;
    if (status === "ONLINE") {
      try {
        const response = await fetch(specUrl);
        if (response.ok) data = await response.json();
      } catch {}
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "openapi.json";
    link.click();
    URL.revokeObjectURL(url);
  }, [specUrl, status]);

  const endpoints = useMemo(() => getOpenApiEndpoints().filter((endpoint) => {
    const needle = query.trim().toLowerCase();
    return (tag === "ALL" || endpoint.tag === tag) && (!needle || `${endpoint.method} ${endpoint.path} ${endpoint.operation.summary ?? ""}`.toLowerCase().includes(needle));
  }), [query, tag]);
  const isLive = status === "ONLINE";

  return <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6">
    <header className="flex flex-col gap-4 border-b border-pitwall-border pb-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-start gap-3">
        <Terminal className="mt-1 size-6 shrink-0 text-pitwall-accent" />
        <div><h1 className="text-2xl font-black tracking-tight text-white">API DOCUMENTATION</h1><p className="mt-1 text-sm text-pitwall-muted">FastAPI OpenAPI documentation and an offline schema snapshot.</p></div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => { setIframeKey((value) => value + 1); void probe(); }}><RefreshCw data-icon="inline-start" />Retry</Button>
        <Button variant="outline" size="sm" onClick={() => void download()}><Download data-icon="inline-start" />openapi.json</Button>
        <Button size="sm" asChild><a href={docsUrl} target="_blank" rel="noreferrer"><ExternalLink data-icon="inline-start" />Open docs</a></Button>
      </div>
    </header>

    <Card><CardHeader className="gap-2"><div className="flex flex-wrap items-center gap-2"><CardTitle className="text-base">{isLive ? "Interactive Swagger UI" : "Offline OpenAPI snapshot"}</CardTitle><Badge variant={isLive ? "green" : "outline"}>{status}</Badge></div><CardDescription className="break-all">Backend: {apiUrl}</CardDescription></CardHeader></Card>

    {isLive ? <Card className="overflow-hidden"><CardContent className="p-0"><iframe key={iframeKey} src={docsUrl} title="PitWall FastAPI Swagger UI" className="min-h-[75dvh] w-full border-0 bg-background" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" /></CardContent></Card> : <SnapshotFallback query={query} setQuery={setQuery} tag={tag} setTag={setTag} endpoints={endpoints} />}
  </main>;
}

function SnapshotFallback({ query, setQuery, tag, setTag, endpoints }: { query: string; setQuery: (value: string) => void; tag: string; setTag: (value: string) => void; endpoints: ReturnType<typeof getOpenApiEndpoints> }) {
  const schemas = getOpenApiSchemas();
  return <section className="flex flex-col gap-4" aria-label="Offline OpenAPI schema snapshot">
    <Card className="border-pitwall-amber/40"><CardHeader className="flex-row items-start gap-3"><AlertTriangle className="mt-1 size-5 shrink-0 text-pitwall-amber" /><div><CardTitle className="text-base">Static snapshot only</CardTitle><CardDescription className="mt-1">This fallback is a captured backend <code>/openapi.json</code>, not a live Swagger interface. Captured {OPENAPI_PROVENANCE.capturedDate} from {OPENAPI_PROVENANCE.source}. Backend version: {OPENAPI_PROVENANCE.backendVersion}.</CardDescription></div></CardHeader></Card>
    <div className="grid gap-3 md:grid-cols-[1fr_auto]"><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Filter OpenAPI operations" placeholder="Filter operations" className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground" /><select value={tag} onChange={(event) => setTag(event.target.value)} aria-label="Filter OpenAPI tags" className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground">{getOpenApiTags().map((value) => <option key={value}>{value}</option>)}</select></div>
    <Card><CardHeader><CardTitle className="text-base">Operations ({endpoints.length})</CardTitle><CardDescription>Derived directly from the vendored OpenAPI snapshot.</CardDescription></CardHeader><CardContent className="grid gap-2">{endpoints.map((endpoint) => <article key={endpoint.id} className="flex flex-col gap-1 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:gap-3"><Badge variant="outline" className={`w-fit font-mono ${methodStyle[endpoint.method] ?? ""}`}>{endpoint.method}</Badge><code className="text-sm text-foreground">{endpoint.path}</code><span className="text-sm text-muted-foreground">{endpoint.operation.summary ?? endpoint.operation.operationId ?? "Undocumented operation"}</span><span className="text-xs text-pitwall-muted sm:ml-auto">{endpoint.tag}</span></article>)}</CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Schemas ({schemas.length})</CardTitle><CardDescription>Named models present in the captured OpenAPI components.</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-2">{schemas.map((schema) => <Badge key={schema.name} variant="secondary">{schema.name}</Badge>)}</CardContent></Card>
  </section>;
}
