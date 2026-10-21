p=r'C:/xampp/htdocs/EREPUTATION1/src/components/dialogs.tsx'
s=open(p,'r',encoding='utf-8',errors='replace').read()
start=s.find('else if (modal.kind === \'team\')')
if start>=0:
    end=s.find('else if (modal.kind === \'communication\')', start)
    if end>=0:
        team='    else if (modal.kind === \"team\") {\n      title=\"Équipe de crise\";\n      body=(\n        <div className=\"team-dialog\">\n          {[[\"Arnaud Kenne\",\"Administrateur\"],[\"Camille Dubois\",\"Responsable Communication\"],[\"Julien Moreau\",\"Analyste Senior\"],[\"Sophie Leroy\",\"Conseiller Juridique\"],[\"Thomas Bernard\",\"Expert Médias\"],[\"Élodie Martin\",\"Community Manager\"]].map(([name,role],i)=>(\n            <div className=\"team-person\" key={name}>\n              {i===0?<Avatar />:<span className={initial-avatar color-}>{name.split(\" \").map(p=>p[0]).join(\"\")}</span>}\n              <span><strong>{name}</strong><small>{role}</small></span>\n              <i className={dot } />\n              <small>{i<4?\"En ligne\":i===4?\"Absent\":\"Hors ligne\"}</small>\n            </div>\n          ))}\n          <Button variant=\"primary\" icon=\"send\" onClick={()=>openModal({kind:\"communication\",title:\"Communiquer avec l’équipe de crise\"})}>Communiquer avec l’équipe</Button>\n        </div>\n      );\n    }\n\n'
        s=s[:start]+team+s[end:]
        open(p,'w',encoding='utf-8').write(s)
        print('ok')
    else:
        print('noend')
else:
    print('nostart')
