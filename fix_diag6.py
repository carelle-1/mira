p=r'C:/xampp/htdocs/EREPUTATION1/src/components/dialogs.tsx'
s=open(p,'r',encoding='utf-8',errors='replace').read()
old='    else if (modal.kind === "team") {'
idx=s.find(old)
if idx>=0:
    # find next else if at same level
    j=s.find('    else if (modal.kind === "communication")', idx)
    if j>=0:
        k=s.rfind('\n', 0, j)
        block='    else if (modal.kind === "team") {title="Équipe de crise";body=<div className="team-dialog">{[[\"Arnaud Kenne\",\"Administrateur\"],[\"Camille Dubois\",\"Responsable Communication\"],[\"Julien Moreau\",\"Analyste Senior\"],[\"Sophie Leroy\",\"Conseiller Juridique\"],[\"Thomas Bernard\",\"Expert Médias\"],[\"Élodie Martin\",\"Community Manager\"]].map(([name,role],i)=><div className="team-person" key={name}>{i===0?<Avatar />:<span className={"initial-avatar color-"+i}>{name.split(" ").map(p=>p[0]).join("")}</span>}<span><strong>{name}</strong><small>{role}</small></span><i className={"dot "+(i<4?"green":"muted")} /><small>{i<4?"En ligne":i===4?"Absent":"Hors ligne"}</small></div>)}<Button variant="primary" icon="send" onClick={()=>openModal({kind:"communication",title:"Communiquer avec l’équipe de crise"})}>Communiquer avec l’équipe</Button></div>;}\n'
        s=s[:idx]+block+s[j:]
        open(p,'w',encoding='utf-8').write(s)
        print('done')
    else:
        print('noj')
else:
    print('no')
