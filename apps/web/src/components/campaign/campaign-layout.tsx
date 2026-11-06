import type {ReactNode} from "react";
import {CampaignHeader} from "./campaign-header";
import {CampaignSidebar} from "./campaign-sidebar";
import {CampaignMobileNav} from "./campaign-mobile-nav";
import type {CampaignSectionId} from "./campaign-navigation";
import styles from "./campaign-layout.module.css";
export function CampaignLayout({activeSection,onNavigate,clubName,saveName,season,competition,onExit,children}:{activeSection:CampaignSectionId;onNavigate:(section:CampaignSectionId)=>void;clubName?:string;saveName?:string;season?:number;competition?:string;onExit:()=>void;children:ReactNode}){
 return <div className={styles.app}><CampaignHeader clubName={clubName} saveName={saveName} season={season} competition={competition} onExit={onExit}/><div className={styles.body}><CampaignSidebar activeSection={activeSection} onNavigate={onNavigate}/><main className={styles.main}>{children}</main></div><CampaignMobileNav activeSection={activeSection} onNavigate={onNavigate}/></div>;
}
