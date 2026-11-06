"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import {useMutation,useQuery,useQueryClient} from "@tanstack/react-query";
import {useForm} from "react-hook-form";
import {zodResolver} from "@hookform/resolvers/zod";
import {ArrowLeft,ArrowRight,CircleHelp,Cog,FolderOpen,Gamepad2,HardDrive,LoaderCircle,Plus,ShieldCheck,SlidersHorizontal,Trophy} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input,Select} from "@/components/ui/input";
import {Card,CardContent,CardDescription,CardHeader,CardTitle} from "@/components/ui/card";
import {Badge} from "@/components/ui/badge";
import {NewGameOutput,newGameSchema,type NewGameInput} from "@/lib/schemas";
import {gameApi} from "@/lib/api";
import {useMenuStore,type MenuSection} from "@/store/menu-store";
import styles from "./main-menu.module.css";
const navigation:{id:MenuSection;label:string;icon:typeof Plus;hint:string}[]=[{id:"new-game",label:"New Game",icon:Plus,hint:"Start a new career"},{id:"load-game",label:"Load Game",icon:FolderOpen,hint:"Continue your journey"},{id:"config",label:"Settings",icon:Cog,hint:"Set up your experience"}];
export function MainMenu(){
 const router=useRouter();const{activeSection,setActiveSection}=useMenuStore();const[message,setMessage]=useState<string|null>(null);const[countryId,setCountryId]=useState<number|null>(null);const queryClient=useQueryClient();
 const overviewQuery=useQuery({queryKey:["master","overview"],queryFn:gameApi.overview,enabled:activeSection==="new-game"||activeSection==="load-game"});
 const packsQuery=useQuery({queryKey:["data-packages","installed"],queryFn:gameApi.dataPackages,enabled:activeSection==="new-game"||activeSection==="load-game"});
 const clubsQuery=useQuery({queryKey:["master","clubs",countryId],queryFn:()=>gameApi.clubs(countryId!),enabled:activeSection==="new-game"&&countryId!==null});
 const savesQuery=useQuery({queryKey:["saves"],queryFn:gameApi.saves,enabled:activeSection==="load-game"});
 const form=useForm<NewGameInput,any,NewGameOutput>({resolver:zodResolver(newGameSchema),defaultValues:{managerName:"",saveName:"",clubId:0}});
 const createSave=useMutation({mutationFn:gameApi.createSave,onSuccess:async({save})=>{await queryClient.invalidateQueries({queryKey:["saves"]});router.push(`/game/${save.id}`);}});
 const loadSave=useMutation({mutationFn:gameApi.openSave,onSuccess:({saveId})=>router.push(`/game/${saveId}`)});
 const goHome=()=>{setMessage(null);setCountryId(null);form.reset();setActiveSection("home");};
 const contentTitle=activeSection==="new-game"?"Start a new career.":activeSection==="load-game"?"Back in the game.":"Make it yours.";
 return <main className={styles.page}>
  <header className={styles.header}><button className={styles.brand} onClick={goHome} type="button" aria-label="Manager Game home"><span className={styles.brandMark}><Trophy size={19}/></span><span><strong>MANAGER<span>.</span></strong><small>FOOTBALL SIMULATION</small></span></button><div className={styles.offline}><i/>OFFLINE CAREER MODE</div><Button variant="ghost" size="icon" aria-label="Help" onClick={()=>setMessage("Manager Game — a data-driven football management simulation.")}><CircleHelp size={18}/></Button></header>
  <div className={styles.main}><section className={styles.intro}><span className={styles.kicker}>THE TOUCHLINE IS YOURS</span>
   {activeSection==="home"?<><h1>Every club has a story.<br/><em>Write yours.</em></h1><p className={styles.lead}>Build your squad. Shape your tactics. Make the decisions that define a legacy.</p><div className={styles.homeActions}><Button size="lg" onClick={()=>setActiveSection("new-game")}><Plus size={17}/>New Game<ArrowRight size={16}/></Button><Button variant="outline" size="lg" onClick={()=>setActiveSection("load-game")}><FolderOpen size={17}/>Load Game</Button></div><button className={styles.settingsLink} type="button" onClick={()=>setActiveSection("config")}><Cog size={14}/>Game settings</button></>:<div className={styles.formPage}>
    <button className={styles.backLink} type="button" onClick={goHome}><ArrowLeft size={14}/>Back to main menu</button><h1>{contentTitle}</h1><p className={styles.leadSmall}>{activeSection==="new-game"?"Choose a country, club and manager identity.":activeSection==="load-game"?"Continue one of your saved careers.":"The essentials for your management experience."}</p>
    {(activeSection==="new-game"||activeSection==="load-game")&&<Card className={styles.packageCard}><CardHeader><div className={styles.packageHeading}><div><CardTitle>Active data packs</CardTitle><CardDescription>Packages installed in your master database</CardDescription></div><Badge>{packsQuery.data?.dataPackages.length??"—"}</Badge></div></CardHeader><CardContent>{packsQuery.isLoading&&<p className={styles.muted}>Reading installed packages…</p>}{packsQuery.isError&&<p className={styles.error}>{packsQuery.error.message}</p>}{packsQuery.data?.dataPackages.length===0&&<p className={styles.muted}>No external data packs installed. Factory world data is available.</p>}{packsQuery.data?.dataPackages.map(pack=><div className={styles.packageRow} key={pack.id}><span>{pack.id}</span><small>v{pack.version}</small></div>)}</CardContent></Card>}
    {activeSection==="new-game"&&<form className={styles.form} onSubmit={form.handleSubmit(values=>{if(countryId!==null)createSave.mutate({...values,countryId});})}>
     <label className={styles.field}>Country<Select value={countryId??""} onChange={event=>{setCountryId(event.target.value?Number(event.target.value):null);form.setValue("clubId",0,{shouldValidate:true});}}><option value="">Select a country</option>{(overviewQuery.data?.countries??[]).map(c=><option key={c.id} value={c.id}>{c.name} ({c.clubCount} clubs)</option>)}</Select></label>
     <label className={styles.field}>Choose your club<Select {...form.register("clubId")} disabled={!countryId||clubsQuery.isLoading}><option value={0}>{countryId?"Select a club":"Select a country first"}</option>{(clubsQuery.data?.clubs??[]).map(c=><option key={c.id} value={c.id}>{c.name} · {c.city??"No city"} · REP {c.reputation}</option>)}</Select></label>
     {clubsQuery.isLoading&&<p className={styles.muted}>Loading clubs…</p>}{clubsQuery.isError&&<p className={styles.error}>{clubsQuery.error.message}</p>}
     <div className={styles.formGrid}><label className={styles.field}>Manager name<Input {...form.register("managerName")} placeholder="e.g. Alex Ferguson"/>{form.formState.errors.managerName&&<small className={styles.error}>{form.formState.errors.managerName.message}</small>}</label><label className={styles.field}>Career name<Input {...form.register("saveName")} placeholder="e.g. The Road to Glory"/>{form.formState.errors.saveName&&<small className={styles.error}>{form.formState.errors.saveName.message}</small>}</label></div>
     {createSave.isError&&<p className={styles.error}>{createSave.error.message}</p>}<div className={styles.formActions}><Button type="submit" size="lg" disabled={createSave.isPending||!countryId||!clubsQuery.data}>{createSave.isPending?<LoaderCircle size={17}/>:<Plus size={17}/>}Create career</Button><Button variant="outline" size="lg" onClick={goHome}>Cancel</Button></div>
    </form>}
    {activeSection==="load-game"&&<div className={styles.saves}>{savesQuery.isLoading&&<p className={styles.muted}>Looking for saved careers…</p>}{savesQuery.isError&&<p className={styles.error}>{savesQuery.error.message}</p>}{savesQuery.data?.saves.length===0&&<Card><CardContent className={styles.emptyState}><HardDrive/><strong>No saved careers yet</strong><p>Start a New Game to create your first save.</p><Button onClick={()=>setActiveSection("new-game")}><Plus size={16}/>New Game</Button></CardContent></Card>}{savesQuery.data?.saves.map(save=><Card key={save.id}><CardContent className={styles.saveRow}><div><strong>{save.name}</strong><p>Manager: {save.managerName} · Club #{save.clubId}</p><small>{new Date(save.createdAt).toLocaleString()}</small></div><Button size="sm" variant="secondary" onClick={()=>loadSave.mutate(save.id)} disabled={loadSave.isPending}><ArrowRight size={15}/>Load</Button></CardContent></Card>)}</div>}
    {activeSection==="config"&&<div className={styles.settingsCards}><Card><CardContent className={styles.settingRow}><SlidersHorizontal/><div><strong>Game settings</strong><p>Settings screen scaffold — preferences will be added here.</p></div></CardContent></Card><Card><CardContent className={styles.settingRow}><ShieldCheck/><div><strong>Local data</strong><p>SQLite databases remain on this machine. Express API owns database access.</p></div></CardContent></Card></div>}
    {message&&<p className={styles.notice}>{message}</p>}
   </div>}</section>
   <aside className={styles.menuPanel}><span className={styles.menuLabel}>MAIN MENU</span><nav>{navigation.map(({id,label,icon:Icon,hint})=><button key={id} type="button" className={[styles.menuItem,activeSection===id?styles.menuItemActive:""].join(" ")} onClick={()=>{setMessage(null);setActiveSection(id);}}><span className={styles.menuIcon}><Icon size={18}/></span><span className={styles.menuText}><strong>{label}</strong><small>{hint}</small></span><ArrowRight className={styles.menuArrow} size={15}/></button>)}</nav><div className={styles.menuFooter}><Gamepad2 size={15}/>MANAGER GAME<span>v0.1.0</span><p>A world of football. A thousand decisions. One legacy.</p></div></aside>
  </div><footer className={styles.footer}><span>© 2026 MANAGER GAME</span><span>BUILT FOR THE LOVE OF THE GAME</span></footer>
 </main>;
}
