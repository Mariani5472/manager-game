"use client";

import { useMemo, useState } from "react";
import type { CampaignCalendarResponse, CampaignOverviewResponse, CampaignPlayerDto, CampaignSquadResponse, CampaignTeamResponse } from "@shared/index";
import { ArrowRight, CalendarDays, Search, Shield, SlidersHorizontal, Trophy, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { Table, TableCell, TableHead } from "@/components/ui/table";
import styles from "./campaign-sections.module.css";

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className={styles.pageHeading}><div><span className={styles.eyebrow}>{eyebrow}</span><h1>{title}</h1><p>{description}</p></div></div>;
}
function formatDate(value: string | null, options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" }) {
  if (!value) return "Date to be confirmed";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", options).format(date);
}
function StatCard({ label, value, detail, icon: Icon }: { label: string; value: string | number; detail: string; icon: typeof Shield }) {
  return <Card className={styles.statCard}><CardContent><div className={styles.statTop}><span>{label}</span><Icon size={16} aria-hidden="true" /></div><strong className={styles.statValue}>{value}</strong><span className={styles.statDetail}>{detail}</span></CardContent></Card>;
}

export function OverviewSection({ data }: { data: CampaignOverviewResponse }) {
  const pendingFixtures = data.competitions.reduce((total, competition) => total + competition.pendingFixtures, 0);
  const next = data.nextFixture;
  return <div className={styles.sectionStack}>
    <PageHeading eyebrow="SEASON HUB" title="Club dashboard" description={`The latest picture of ${data.club.name} and its season.`} />
    <section className={styles.dashboardHero} aria-label="Next fixture">
      <div className={styles.heroMain}>
        <div className={styles.heroEyebrow}><CalendarDays size={14} /> NEXT FIXTURE <Badge variant={next?.status === "IN_PROGRESS" ? "success" : "default"}>{next?.status?.replaceAll("_", " ") ?? "NO FIXTURE"}</Badge></div>
        {next ? <>
          <p className={styles.heroCompetition}>{next.competition} <span>·</span> {next.stage}</p>
          <div className={styles.heroMatch}>
            <div className={styles.heroClub}><span className={styles.clubInitial}>{next.homeClub.slice(0, 1).toUpperCase()}</span><strong>{next.homeClub}</strong><small>HOME</small></div>
            <span className={styles.heroVersus}>VS</span>
            <div className={styles.heroClub}><span className={styles.clubInitial}>{next.awayClub.slice(0, 1).toUpperCase()}</span><strong>{next.awayClub}</strong><small>AWAY</small></div>
          </div>
          <div className={styles.heroFooter}><span>{formatDate(next.scheduledAt, { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}</span><span>{next.round}</span></div>
        </> : <div className={styles.heroEmpty}><strong>No upcoming fixture</strong><span>Your next match will appear here when the calendar is available.</span></div>}
      </div>
      <div className={styles.heroAside}>
        <span className={styles.asideLabel}>LAST RESULT</span>
        {data.recentResult ? <><strong className={styles.lastScore}>{data.recentResult.score ?? "—"}</strong><span className={styles.lastTeams}>{data.recentResult.homeClub}</span><span className={styles.lastTeams}>{data.recentResult.awayClub}</span><span className={styles.lastCompetition}>{data.recentResult.competition}</span></> : <span className={styles.noResult}>No completed matches yet.</span>}
      </div>
    </section>
    <div className={styles.statsGrid}>
      <StatCard label="SQUAD" value={data.squadSize} detail="Registered players" icon={Shield} />
      <StatCard label="COMPETITIONS" value={data.competitions.length} detail="Season entries" icon={Trophy} />
      <StatCard label="FIXTURES LEFT" value={pendingFixtures} detail="Across competitions" icon={CalendarDays} />
      <StatCard label="REPUTATION" value={data.club.reputation} detail="Club reputation" icon={ArrowRight} />
    </div>
    <div className={styles.dashboardColumns}>
      <Card><CardHeader><div><CardTitle>Competition overview</CardTitle><CardDescription>Progress and league position</CardDescription></div></CardHeader>
        <CardContent className={styles.competitionList}>
          {data.competitions.map(competition => {
            const standing = competition.standing.find(row => row.isManaged);
            const total = competition.completedFixtures + competition.pendingFixtures;
            return <section className={styles.competitionBlock} key={competition.stageId}>
              <div className={styles.competitionHeading}><div><strong>{competition.competition}</strong><span>{competition.stage} · {competition.seasonYear}</span></div><Badge variant={competition.stageStatus === "COMPLETED" ? "success" : "info"}>{competition.stageStatus === "COMPLETED" ? "Completed" : "In progress"}</Badge></div>
              <div className={styles.competitionProgress}><div><span>{competition.completedFixtures} played</span><span>{competition.pendingFixtures} remaining</span></div><div className={styles.progressTrack}><span style={{ width: `${total ? competition.completedFixtures / total * 100 : 0}%` }} /></div></div>
              {competition.standing.length ? <>
                <div className={styles.standingSummary}><span>YOUR POSITION</span><strong>{standing ? `#${standing.position}` : "—"}</strong><span>{standing ? `${standing.points} pts · ${standing.played} played` : "Not ranked"}</span></div>
                <Table className={styles.standingTable}><thead><tr><TableHead>#</TableHead><TableHead>Club</TableHead><TableHead className={styles.alignRight}>P</TableHead><TableHead className={styles.alignRight}>GD</TableHead><TableHead className={styles.alignRight}>Pts</TableHead></tr></thead><tbody>{competition.standing.slice(0, 5).map(row => <tr key={row.position} className={row.isManaged ? styles.managedRow : undefined}><TableCell>{row.position}</TableCell><TableCell><span className={styles.clubCell}>{row.club}{row.isManaged && <Badge variant="success">You</Badge>}</span></TableCell><TableCell className={styles.alignRight}>{row.played}</TableCell><TableCell className={styles.alignRight}>{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</TableCell><TableCell className={styles.alignRight}><strong>{row.points}</strong></TableCell></tr>)}</tbody></Table>
              </> : <p className={styles.competitionNote}>Knockout competition · {competition.completedFixtures} completed, {competition.pendingFixtures} remaining.</p>}
            </section>;
          })}
          {!data.competitions.length && <p className={styles.emptyText}>No competition entries are available for this season.</p>}
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Club profile</CardTitle><CardDescription>Identity and home ground</CardDescription></CardHeader><CardContent>
        <div className={styles.clubProfile}><span className={styles.profileCrest}><Shield size={25} /></span><div><h2>{data.club.name}</h2><p>{data.club.city ?? "City unavailable"} · {data.club.nation}</p></div></div>
        <div className={styles.profileFacts}><div><span>STADIUM</span><strong>{data.club.stadium ?? "Not registered"}</strong></div><div><span>CAPACITY</span><strong>{data.club.stadiumCapacity?.toLocaleString("en-GB") ?? "—"}</strong></div><div><span>REPUTATION</span><strong>{data.club.reputation}</strong></div></div>
      </CardContent></Card>
    </div>
  </div>;
}

function fixtureStatusVariant(status: string): "default" | "success" | "warning" | "danger" | "info" {
  if (status === "COMPLETED") return "success";
  if (status === "IN_PROGRESS") return "info";
  if (status === "POSTPONED") return "warning";
  if (status === "CANCELLED") return "danger";
  return "default";
}
export function CalendarSection({ data }: { data: CampaignCalendarResponse }) {
  const [filter, setFilter] = useState<"all" | "upcoming" | "results">("all");
  const fixtures = useMemo(() => {
    const filtered = data.fixtures.filter(item => filter === "all" || (filter === "results" ? item.status === "COMPLETED" : item.status !== "COMPLETED"));
    return [...filtered].sort((a, b) => {
      const aTime = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Number.MAX_SAFE_INTEGER;
      return filter === "results" ? bTime - aTime : aTime - bTime;
    });
  }, [data.fixtures, filter]);
  const upcomingCount = data.fixtures.filter(item => item.status !== "COMPLETED").length;
  const resultCount = data.fixtures.length - upcomingCount;
  return <div className={styles.sectionStack}>
    <PageHeading eyebrow="FIXTURES & RESULTS" title="Calendar" description="A clear view of your club's matches, past and upcoming." />
    <Card><CardHeader className={styles.calendarHeader}><div><CardTitle>Match schedule</CardTitle><CardDescription>{data.fixtures.length} fixtures involving your club</CardDescription></div>
      <div className={styles.filterGroup} role="group" aria-label="Filter fixtures">
        <Button size="sm" variant={filter === "all" ? "secondary" : "ghost"} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All <span>{data.fixtures.length}</span></Button>
        <Button size="sm" variant={filter === "upcoming" ? "secondary" : "ghost"} aria-pressed={filter === "upcoming"} onClick={() => setFilter("upcoming")}>Upcoming <span>{upcomingCount}</span></Button>
        <Button size="sm" variant={filter === "results" ? "secondary" : "ghost"} aria-pressed={filter === "results"} onClick={() => setFilter("results")}>Results <span>{resultCount}</span></Button>
      </div>
    </CardHeader><CardContent className={styles.calendarContent}>
      {fixtures.map(item => <article className={styles.fixtureRow} key={item.id}><div className={styles.fixtureDate}><strong>{formatDate(item.scheduledAt)}</strong><span>{item.round}</span></div><div className={styles.fixtureMatch}><div className={styles.fixtureTeams}><strong>{item.homeClub}</strong><span>{item.score ?? "vs"}</span><strong>{item.awayClub}</strong></div><span className={styles.fixtureCompetition}>{item.competition} · {item.stage}</span></div><Badge variant={fixtureStatusVariant(item.status)}>{item.status.replaceAll("_", " ")}</Badge></article>)}
      {!fixtures.length && <div className={styles.emptyState}><CalendarDays size={22} /><strong>No matches in this view</strong><span>{filter === "results" ? "Completed results will appear here." : "There are no upcoming fixtures at the moment."}</span></div>}
    </CardContent></Card>
  </div>;
}

function MetricBar({ label, value }: { label: string; value: number }) {
  const safeValue = Math.max(0, Math.min(100, value));
  return <div className={styles.metricBar}><div><span>{label}</span><strong>{value}</strong></div><span className={styles.metricTrack}><span style={{ width: `${safeValue}%` }} /></span></div>;
}
function playerStatus(status: string): "default" | "success" | "warning" | "info" {
  if (status === "FIRST_TEAM") return "success";
  if (status === "RESERVE") return "info";
  return "default";
}
function PlayerDetails({ player }: { player: CampaignPlayerDto }) {
  return <div className={styles.playerDetails}>
    <div className={styles.playerIdentity}><span className={styles.playerNumber}>{player.shirtNumber ?? "—"}</span><div><strong>{player.name}</strong><span>{player.positions.join(" · ") || "Position not registered"}</span></div></div>
    <div className={styles.playerStatusLine}><span>Squad status</span><Badge variant={playerStatus(player.squadStatus)}>{player.squadStatus.replaceAll("_", " ")}</Badge></div>
    <div className={styles.playerMetrics}><MetricBar label="Energy" value={player.energy} /><MetricBar label="Morale" value={player.morale} /><MetricBar label="Sharpness" value={player.sharpness} /></div>
    <p className={styles.detailDisclaimer}>These are the condition values currently available in this save. Technical attributes and contract details are not part of this screen's data yet.</p>
  </div>;
}
export function SquadSection({ data }: { data: CampaignSquadResponse }) {
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("ALL");
  const [selectedPlayer, setSelectedPlayer] = useState<CampaignPlayerDto | null>(null);
  const positions = useMemo(() => [...new Set(data.players.flatMap(player => player.positions))].sort(), [data.players]);
  const players = useMemo(() => data.players.filter(player => `${player.name} ${player.positions.join(" ")}`.toLowerCase().includes(search.trim().toLowerCase()) && (position === "ALL" || player.positions.includes(position))), [data.players, position, search]);
  const firstTeamCount = data.players.filter(player => player.squadStatus === "FIRST_TEAM").length;
  return <div className={styles.sectionStack}>
    <PageHeading eyebrow="FIRST TEAM" title="Squad" description={`${data.club.name} · ${data.players.length} registered players`} />
    <div className={styles.squadSummary}><div><Users size={17} /><span><strong>{data.players.length}</strong> players registered</span></div><div><Shield size={17} /><span><strong>{firstTeamCount}</strong> first-team players</span></div></div>
    <Card><CardHeader className={styles.squadHeader}><div><CardTitle>Player list</CardTitle><CardDescription>Select a player to inspect their current condition</CardDescription></div><label className={styles.searchBox}><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search players" aria-label="Search players" /></label></CardHeader>
      <CardContent className={styles.squadContent}>
        <div className={styles.positionFilters} aria-label="Filter by position"><SlidersHorizontal size={14} /><Button size="sm" variant={position === "ALL" ? "secondary" : "ghost"} aria-pressed={position === "ALL"} onClick={() => setPosition("ALL")}>All positions</Button>{positions.map(item => <Button key={item} size="sm" variant={position === item ? "secondary" : "ghost"} aria-pressed={position === item} onClick={() => setPosition(item)}>{item}</Button>)}</div>
        <Table className={styles.squadTable}><thead><tr><TableHead>No.</TableHead><TableHead>Player</TableHead><TableHead>Position</TableHead><TableHead>Status</TableHead><TableHead>Energy</TableHead><TableHead>Morale</TableHead><TableHead>Sharpness</TableHead></tr></thead><tbody>{players.map(player => <tr key={player.id}><TableCell>{player.shirtNumber ?? "—"}</TableCell><TableCell><button type="button" className={styles.playerLink} onClick={() => setSelectedPlayer(player)}>{player.name}</button></TableCell><TableCell><span className={styles.positionText}>{player.positions.join(" / ") || "—"}</span></TableCell><TableCell><Badge variant={playerStatus(player.squadStatus)}>{player.squadStatus.replaceAll("_", " ")}</Badge></TableCell><TableCell><span className={styles.tableMetric}>{player.energy}</span></TableCell><TableCell><span className={styles.tableMetric}>{player.morale}</span></TableCell><TableCell><span className={styles.tableMetric}>{player.sharpness}</span></TableCell></tr>)}</tbody></Table>
        {!players.length && <div className={styles.emptyState}><Users size={22} /><strong>No players found</strong><span>Try another name or position filter.</span></div>}
      </CardContent>
    </Card>
    <Modal open={selectedPlayer !== null} title="Player details" onClose={() => setSelectedPlayer(null)}>{selectedPlayer && <PlayerDetails player={selectedPlayer} />}</Modal>
  </div>;
}

function TeamStat({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return <div className={styles.teamStat}><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}
function formatAmount(value: number) { return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value); }
export function TeamSection({ data }: { data: CampaignTeamResponse }) {
  const wageUsage = data.finances && data.finances.weeklyWageBudget > 0 ? Math.max(0, Math.min(100, data.finances.wageBillWeekly / data.finances.weeklyWageBudget * 100)) : null;
  const remainingWageBudget = data.finances ? data.finances.weeklyWageBudget - data.finances.wageBillWeekly : null;
  return <div className={styles.sectionStack}>
    <PageHeading eyebrow="CLUB MANAGEMENT" title="Club" description="Club identity, tactical approach and financial overview." />
    <Card><CardHeader><CardTitle>Club identity</CardTitle><CardDescription>Profile and home ground</CardDescription></CardHeader><CardContent>
      <div className={styles.clubIdentity}><span className={styles.clubIdentityCrest}><Shield size={29} /></span><div><h2>{data.club.name}</h2><p>{data.club.city ?? "City unavailable"} · {data.club.nation}</p><Badge variant="success">Managed club</Badge></div><div className={styles.reputation}><strong>{data.club.reputation}</strong><span>REPUTATION</span></div></div>
      <div className={styles.clubFacts}><TeamStat label="HOME STADIUM" value={data.club.stadium ?? "Not registered"} /><TeamStat label="CAPACITY" value={data.club.stadiumCapacity?.toLocaleString("en-GB") ?? "—"} /><TeamStat label="COUNTRY" value={data.club.nation} /><TeamStat label="CITY" value={data.club.city ?? "—"} /></div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Tactical identity</CardTitle><CardDescription>Current saved team instructions</CardDescription></CardHeader><CardContent className={styles.tacticalContent}>
      <div className={styles.tacticHero}><span>FORMATION</span><strong>{data.tactics.formation}</strong><Badge variant="info">{data.tactics.mentality}</Badge></div>
      <div className={styles.tacticsGrid}><TeamStat label="PRESSING" value={data.tactics.pressing} detail="Intensity" /><TeamStat label="TEMPO" value={data.tactics.tempo} detail="Match tempo" /><TeamStat label="DEFENSIVE LINE" value={data.tactics.defensiveLine} /><TeamStat label="WIDTH" value={data.tactics.width} /><TeamStat label="PASSING DIRECTNESS" value={data.tactics.passingDirectness} /><TeamStat label="COUNTER ATTACK" value={data.tactics.counterAttack ? "Enabled" : "Disabled"} /></div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Club finances</CardTitle><CardDescription>Budgets and weekly wage commitments</CardDescription></CardHeader><CardContent>
      {data.finances ? <><div className={styles.financeGrid}><TeamStat label="CLUB BALANCE" value={formatAmount(data.finances.balance)} /><TeamStat label="TRANSFER BUDGET" value={formatAmount(data.finances.transferBudget)} /><TeamStat label="WEEKLY WAGE BUDGET" value={formatAmount(data.finances.weeklyWageBudget)} /><TeamStat label="WEEKLY WAGE BILL" value={formatAmount(data.finances.wageBillWeekly)} /></div>
        <div className={styles.wageOverview}><div><span>Wage budget remaining</span><strong>{remainingWageBudget === null ? "—" : formatAmount(remainingWageBudget)}</strong></div>{wageUsage !== null && <><div className={styles.wageTrack}><span style={{ width: `${wageUsage}%` }} /></div><small>{Math.round(wageUsage)}% of weekly wage budget committed</small></>}</div>
      </> : <p className={styles.emptyText}>Financial data has not been initialized in this save.</p>}
    </CardContent></Card>
  </div>;
}
