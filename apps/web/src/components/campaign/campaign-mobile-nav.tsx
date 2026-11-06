"use client";
import {campaignNavigation,type CampaignSectionId} from "./campaign-navigation";
import styles from "./campaign-layout.module.css";
export function CampaignMobileNav({activeSection,onNavigate}:{activeSection:CampaignSectionId;onNavigate:(section:CampaignSectionId)=>void}){return <nav className={styles.mobileNav} aria-label="Campaign sections">{campaignNavigation.map(({id,label,icon:Icon})=><button key={id} type="button" aria-current={activeSection===id?"page":undefined} className={[styles.mobileNavItem,activeSection===id?styles.mobileNavItemActive:""].join(" ")} onClick={()=>onNavigate(id)}><Icon size={18}/><span>{label}</span></button>)}</nav>;}
