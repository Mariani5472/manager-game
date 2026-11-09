'use client';
import Link from 'next/link';
import {campaignNavigation,type CampaignSectionId} from './campaign-navigation';
import styles from './campaign-layout.module.css';
export function CampaignMobileNav({activeSection,basePath}:{activeSection:CampaignSectionId;basePath:string}){
 return <nav className={styles.mobileNav} aria-label="Campaign sections">{campaignNavigation.map(({id,label,icon:Icon})=><Link key={id} href={`${basePath}/${id}`} aria-current={activeSection===id?'page':undefined} className={[styles.mobileNavItem,activeSection===id?styles.mobileNavItemActive:''].join(' ')}><Icon size={18}/><span>{label}</span></Link>)}</nav>;
}
