p=r'C:/xampp/htdocs/EREPUTATION1/src/components/dialogs.tsx'
s=open(p,'r',encoding='utf-8',errors='replace').read()
start=s.find(\"else if (modal.kind === 'team')\")
if start>=0:
    end=s.find(\"else if (modal.kind === 'communication')\", start)
    if end>=0:
        team=\"    else if (modal.kind === 'team') {title='Équipe de crise';body=(<div className='team-dialog'>{[['Arnaud Kenne','Administrateur'],['Camille Dubois','Responsable Communication'],['Julien Moreau','Analyste Senior'],['Sophie Leroy','Conseiller Juridique'],['Thomas Bernard','Expert Médias'],['Élodie Martin','Community Manager']].map(([name,role],i)=>(<div className='team-person' key={name}>{i===0?<Avatar />:<span className={'initial-avatar color-'+i}>{name.split(' ').map(p=>p[0]).join('')}</span>}<span><strong>{name}</strong><small>{role}</small></span><i className={'dot '+(i<4?'green':'muted')} /><small>{i<4?'En ligne':i===4?'Absent':'Hors ligne'}</small></div>))}<Button variant='primary' icon='send' onClick={()=>openModal({kind:'communication',title:'Communiquer avec l’équipe de crise'})}>Communiquer avec l’équipe</Button></div>);}\n\"
        s=s[:start]+team+s[end:]
        open(p,'w',encoding='utf-8').write(s)
        print('done')
    else:
        print('noend')
else:
    print('nostart')
