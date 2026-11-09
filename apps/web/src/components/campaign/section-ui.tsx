import { Shield } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import styles from './campaign-sections.module.css';
export function PageHeading({eyebrow,title,description}:{eyebrow:string;title:string;description:string}) {
 return <div className={styles.pageHeading}><div><span className={styles.eyebrow}>{eyebrow}</span><h1>{title}</h1><p>{description}</p></div></div>;
}
export function StatCard({label,value,detail,icon:Icon}:{label:string;value:string|number;detail:string;icon:typeof Shield}) {
 return <Card className={styles.statCard}><CardContent><div className={styles.statTop}><span>{label}</span><Icon size={16} aria-hidden="true"/></div><strong className={styles.statValue}>{value}</strong><span className={styles.statDetail}>{detail}</span></CardContent></Card>;
}
export function TeamStat({label,value,detail}:{label:string;value:string|number;detail?:string}) {
 return <div className={styles.teamStat}><span>{label}</span><strong>{value}</strong>{detail&&<small>{detail}</small>}</div>;
}
