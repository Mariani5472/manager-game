"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, ChevronRight, CircleHelp, Cog, FolderOpen, Gamepad2, HardDrive, LoaderCircle, Plus, ShieldCheck, SlidersHorizontal, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { newGameSchema, type NewGameInput } from "@/lib/schemas";
import { gameApi } from "@/lib/api";
import { useMenuStore, type MenuSection } from "@/store/menu-store";

const navigation: { id: MenuSection; label: string; icon: typeof Plus; hint: string }[] = [
  { id: "new-game", label: "New Game", icon: Plus, hint: "Start a new career" },
  { id: "load-game", label: "Load Game", icon: FolderOpen, hint: "Continue your journey" },
  { id: "config", label: "Config", icon: Cog, hint: "Set up your experience" },
];

export function MainMenu() {
  const { activeSection, setActiveSection } = useMenuStore();
  const [message, setMessage] = useState<string | null>(null);
  const [countryId, setCountryId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const overviewQuery = useQuery({
    queryKey: ["master", "overview"],
    queryFn: gameApi.overview,
    enabled: activeSection === "new-game" || activeSection === "load-game",
  });
  const clubsQuery = useQuery({
    queryKey: ["master", "clubs", countryId],
    queryFn: () => gameApi.clubs(countryId!),
    enabled: activeSection === "new-game" && countryId !== null,
  });
  const savesQuery = useQuery({
    queryKey: ["saves"],
    queryFn: gameApi.saves,
    enabled: activeSection === "load-game",
  });
  const form = useForm<NewGameInput>({
    resolver: zodResolver(newGameSchema),
    defaultValues: { managerName: "", saveName: "", clubId: 0 },
  });
  const createSave = useMutation({
    mutationFn: gameApi.createSave,
    onSuccess: async ({ save }) => {
      await queryClient.invalidateQueries({ queryKey: ["saves"] });
      setMessage(`Career "${save.name}" created successfully.`);
      setActiveSection("load-game");
    },
  });
  const loadSave = useMutation({
    mutationFn: gameApi.openSave,
    onSuccess: () => setMessage("Save validated and opened. The in-game dashboard is the next implementation step."),
  });

  const goHome = () => {
    setMessage(null);
    setCountryId(null);
    form.reset();
    setActiveSection("home");
  };

  const onCountryChange = (value: string) => {
    const nextCountryId = value ? Number(value) : null;
    setCountryId(nextCountryId);
    form.setValue("clubId", 0, { shouldValidate: true });
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#090b0a]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_72%_28%,rgba(51,90,58,0.22),transparent_42%),linear-gradient(115deg,transparent_35%,rgba(163,230,53,0.035)_100%)]" />
      <div className="pointer-events-none absolute -right-32 top-16 h-[560px] w-[560px] rounded-full border border-white/[0.035]" />
      <div className="pointer-events-none absolute -right-16 top-32 h-[430px] w-[430px] rounded-full border border-white/[0.045]" />
      <header className="relative z-10 flex h-20 items-center justify-between border-b border-white/[0.07] px-6 md:px-12">
        <button onClick={goHome} className="flex items-center gap-3 text-left" aria-label="Manager Game home">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-lime-300 text-zinc-950"><Trophy size={21} /></span>
          <span><span className="block text-sm font-black tracking-[0.2em] text-white">MANAGER<span className="text-lime-300">.</span></span><span className="mt-0.5 block text-[9px] font-semibold tracking-[0.28em] text-zinc-500">FOOTBALL SIMULATION</span></span>
        </button>
        <div className="hidden items-center gap-2 text-[10px] font-semibold tracking-[0.2em] text-zinc-500 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-lime-300 shadow-[0_0_12px_#bef264]" />OFFLINE CAREER MODE</div>
        <Button variant="ghost" size="icon" aria-label="Help" onClick={() => setMessage("Manager Game — a data-driven football management simulation.")}><CircleHelp size={18} /></Button>
      </header>
      <section className="relative z-10 mx-auto grid min-h-[calc(100vh-80px)] max-w-[1440px] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex flex-col justify-center px-6 py-14 md:px-12 lg:px-20">
          <div className="mb-8 flex items-center gap-3"><span className="h-px w-10 bg-lime-300" /><span className="text-[10px] font-bold tracking-[0.35em] text-lime-300">THE TOUCHLINE IS YOURS</span></div>
          {activeSection === "home" ? (
            <>
              <h1 className="max-w-3xl text-5xl font-black leading-[1.02] tracking-[-0.055em] text-white sm:text-6xl xl:text-7xl">Every club has a story.<br /><span className="text-lime-300">Write yours.</span></h1>
              <p className="mt-7 max-w-lg text-base leading-7 text-zinc-400">Build your squad. Shape your tactics. Make the decisions that define a legacy.</p>
              <div className="mt-12 flex flex-wrap items-center gap-3"><Button size="lg" onClick={() => setActiveSection("new-game")}><Plus size={18} />New Game<ArrowRight size={16} /></Button><Button variant="outline" size="lg" onClick={() => setActiveSection("load-game")}><FolderOpen size={17} />Load Game</Button></div>
              <button onClick={() => setActiveSection("config")} className="mt-7 flex w-fit items-center gap-2 text-xs font-semibold text-zinc-500 transition hover:text-lime-300"><Cog size={14} />Game configuration<ChevronRight size={13} /></button>
            </>
          ) : (
            <div className="max-w-2xl">
              <button onClick={goHome} className="mb-8 flex items-center gap-2 text-xs font-semibold text-zinc-500 hover:text-lime-300"><ArrowLeft size={14} />BACK TO MAIN MENU</button>
              <h1 className="text-4xl font-black tracking-[-0.04em] text-white sm:text-5xl">{activeSection === "new-game" ? "Start a new career." : activeSection === "load-game" ? "Back in the game." : "Make it yours."}</h1>
              <p className="mt-4 text-sm leading-6 text-zinc-400">{activeSection === "new-game" ? "Review installed data packs, choose a country and select your club." : activeSection === "load-game" ? "Your saved careers and loaded world packages are listed below." : "The essentials for your management experience."}</p>

              {(activeSection === "new-game" || activeSection === "load-game") && (
                <section className="mt-7 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div><p className="text-[10px] font-bold tracking-[0.2em] text-lime-300">ACTIVE DATA PACKS</p><p className="mt-1 text-xs text-zinc-500">Packages installed in your master database</p></div>
                    <span className="rounded-full bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300">{overviewQuery.data?.dataPackages.length ?? "—"}</span>
                  </div>
                  {overviewQuery.isLoading && <p className="text-xs text-zinc-500">Reading master database…</p>}
                  {overviewQuery.isError && <p className="text-xs text-red-400">{overviewQuery.error.message}</p>}
                  {overviewQuery.data?.dataPackages.length === 0 && <p className="text-xs text-zinc-500">No external data packs installed. Factory world data is still available.</p>}
                  <div className="space-y-2">
                    {overviewQuery.data?.dataPackages.map((pack) => (
                      <div key={pack.id} className="flex items-center justify-between gap-3 rounded-lg bg-black/20 px-3 py-2">
                        <div className="min-w-0"><p className="truncate text-sm font-medium text-zinc-200">{pack.id}</p><p className="text-[10px] text-zinc-500">Installed {new Date(pack.installedAt).toLocaleDateString()}</p></div>
                        <span className="shrink-0 font-mono text-xs text-lime-200">v{pack.version}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {activeSection === "new-game" && (
                <form className="mt-7 space-y-5" onSubmit={form.handleSubmit((values) => { if (countryId === null) return; createSave.mutate({ ...values, countryId }); })}>
                  <label className="block text-xs font-semibold text-zinc-300">COUNTRY
                    <select value={countryId ?? ""} onChange={(event) => onCountryChange(event.target.value)} className="mt-2 h-12 w-full rounded-lg border border-zinc-800 bg-zinc-900/80 px-4 text-sm text-white outline-none focus:border-lime-300">
                      <option value="">Select a country</option>
                      {(overviewQuery.data?.countries ?? []).map((country) => <option key={country.id} value={country.id}>{country.name} ({country.clubCount} clubs)</option>)}
                    </select>
                  </label>
                  <label className="block text-xs font-semibold text-zinc-300">CHOOSE YOUR CLUB
                    <select {...form.register("clubId")} disabled={!countryId || clubsQuery.isLoading} className="mt-2 h-12 w-full rounded-lg border border-zinc-800 bg-zinc-900/80 px-4 text-sm text-white outline-none focus:border-lime-300 disabled:opacity-50">
                      <option value={0}>{countryId ? "Select a club" : "Select a country first"}</option>
                      {(clubsQuery.data?.clubs ?? []).map((club) => <option key={club.id} value={club.id}>{club.name} · {club.city ?? "No city"} · REP {club.reputation}</option>)}
                    </select>
                  </label>
                  {clubsQuery.isLoading && <p className="text-xs text-zinc-500">Loading clubs for selected country…</p>}
                  {clubsQuery.isError && <p className="text-xs text-red-400">{clubsQuery.error.message}</p>}
                  {clubsQuery.data && <p className="text-xs text-zinc-500">{clubsQuery.data.country.name}: {clubsQuery.data.clubs.length} playable clubs</p>}
                  <div className="grid gap-5 sm:grid-cols-2">
                    <label className="block text-xs font-semibold text-zinc-300">MANAGER NAME<input {...form.register("managerName")} placeholder="e.g. Alex Ferguson" className="mt-2 h-12 w-full rounded-lg border border-zinc-800 bg-zinc-900/80 px-4 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-lime-300" />{form.formState.errors.managerName && <span className="mt-1 block text-xs text-red-400">{form.formState.errors.managerName.message}</span>}</label>
                    <label className="block text-xs font-semibold text-zinc-300">CAREER NAME<input {...form.register("saveName")} placeholder="e.g. The Road to Glory" className="mt-2 h-12 w-full rounded-lg border border-zinc-800 bg-zinc-900/80 px-4 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-lime-300" />{form.formState.errors.saveName && <span className="mt-1 block text-xs text-red-400">{form.formState.errors.saveName.message}</span>}</label>
                  </div>
                  {createSave.isError && <p className="text-xs text-red-400">{createSave.error.message}</p>}
                  <div className="flex flex-wrap gap-3 pt-2"><Button type="submit" size="lg" disabled={createSave.isPending || !countryId || !clubsQuery.data}>{createSave.isPending ? <LoaderCircle className="animate-spin" size={17} /> : <Plus size={17} />}Create Career</Button><Button type="button" variant="outline" size="lg" onClick={goHome}>Cancel</Button></div>
                </form>
              )}

              {activeSection === "load-game" && (
                <div className="mt-7 space-y-3">
                  {savesQuery.isLoading && <p className="text-sm text-zinc-500">Looking for saved careers…</p>}
                  {savesQuery.isError && <p className="text-sm text-red-400">{savesQuery.error.message}</p>}
                  {savesQuery.data?.saves.length === 0 && <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-8 text-center"><HardDrive className="mx-auto mb-3 text-zinc-600" size={26} /><p className="font-semibold text-zinc-300">No saved careers yet</p><p className="mt-1 text-xs text-zinc-500">Start a New Game to create your first save.</p><Button className="mt-5" onClick={() => setActiveSection("new-game")}><Plus size={16} />New Game</Button></div>}
                  {savesQuery.data?.saves.map((save) => <div key={save.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4"><div><p className="font-semibold text-white">{save.name}</p><p className="mt-1 text-xs text-zinc-500">Manager: {save.managerName} · Club #{save.clubId}</p><p className="mt-1 text-[10px] uppercase tracking-wider text-zinc-600">{new Date(save.createdAt).toLocaleString()}</p></div><Button size="sm" variant="secondary" onClick={() => loadSave.mutate(save.id)} disabled={loadSave.isPending}><ArrowRight size={15} />Load</Button></div>)}
                  {loadSave.isError && <p className="text-xs text-red-400">{loadSave.error.message}</p>}
                </div>
              )}
              {activeSection === "config" && <div className="mt-9 space-y-3">
                <div className="flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"><SlidersHorizontal className="text-lime-300" size={20} /><div><p className="text-sm font-semibold text-white">Game settings</p><p className="mt-1 text-xs text-zinc-500">Settings screen scaffold — preferences will be added here.</p></div></div>
                <div className="flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"><ShieldCheck className="text-lime-300" size={20} /><div><p className="text-sm font-semibold text-white">Local data</p><p className="mt-1 text-xs text-zinc-500">SQLite databases remain on this machine. Express API owns database access.</p></div></div>
              </div>}
              {message && <p className="mt-6 rounded-lg border border-lime-300/20 bg-lime-300/10 p-3 text-xs text-lime-200">{message}</p>}
            </div>
          )}
        </div>
        <aside className="relative hidden flex-col justify-center border-l border-white/[0.06] bg-black/10 px-10 py-12 lg:flex"><div className="absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.3))]" /><div className="relative"><div className="mb-10 text-[10px] font-bold tracking-[0.3em] text-zinc-600">MAIN MENU</div><nav className="space-y-2">{navigation.map(({ id, label, icon: Icon, hint }, index) => <button key={id} onClick={() => { setMessage(null); setActiveSection(id); }} className={`group flex w-full items-center gap-4 rounded-xl border px-4 py-4 text-left transition ${activeSection === id ? "border-lime-300/30 bg-lime-300/[0.08]" : "border-transparent hover:border-zinc-800 hover:bg-zinc-900/60"}`}><span className={`flex h-11 w-11 items-center justify-center rounded-lg ${activeSection === id ? "bg-lime-300 text-zinc-950" : "bg-zinc-900 text-zinc-500 group-hover:text-white"}`}><Icon size={19} /></span><span className="min-w-0 flex-1"><span className={`block text-sm font-bold ${activeSection === id ? "text-lime-200" : "text-zinc-200"}`}>{label}</span><span className="mt-1 block text-xs text-zinc-600">{hint}</span></span><ChevronRight size={16} className={activeSection === id ? "text-lime-300" : "text-zinc-700"} /><span className="sr-only">Menu item {index + 1}</span></button>)}</nav><div className="mt-12 border-t border-zinc-800/80 pt-6"><div className="flex items-center gap-3 text-xs text-zinc-500"><Gamepad2 size={15} />MANAGER GAME<span className="ml-auto font-mono text-zinc-700">v0.1.0</span></div><p className="mt-3 text-[10px] leading-5 text-zinc-700">A world of football. A thousand decisions. One legacy.</p></div></div></aside>
      </section>
      <footer className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] px-6 py-5 text-[9px] font-semibold tracking-[0.18em] text-zinc-700 md:px-12"><span>© 2026 MANAGER GAME</span><span>BUILT FOR THE LOVE OF THE GAME</span></footer>
    </main>
  );
}
