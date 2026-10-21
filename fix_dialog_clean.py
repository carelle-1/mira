p=r'C:/xampp/htdocs/EREPUTATION1/src/components/dialogs.tsx'
s=open(p,encoding='utf-8',errors='replace').read()
# replace broken team+comm block with clean
start=s.find('    else if (modal.kind === \\'team\\')')
end=s.find('    else if (modal.kind === \\'communication\\')', start) if start>=0 else -1
if start>=0 and end>=0:
    team = '''    else if (modal.kind === "team") {
      title = 'Équipe de crise';
      body = (
        <div className="team-dialog">
          {[
            ['Arnaud Kenne', 'Administrateur'],
            ['Camille Dubois', 'Responsable Communication'],
            ['Julien Moreau', 'Analyste Senior'],
            ['Sophie Leroy', 'Conseiller Juridique'],
            ['Thomas Bernard', 'Expert Médias'],
            ['Élodie Martin', 'Community Manager'],
          ].map(([name, role], i) => (
            <div className="team-person" key={name}>
              {i === 0 ? <Avatar /> : (
                <span className={initial-avatar color-}>
                  {name.split(' ').map(p => p[0]).join('')}
                </span>
              )}
              <span>
                <strong>{name}</strong>
                <small>{role}</small>
              </span>
              <i className={dot } />
              <small>{i < 4 ? 'En ligne' : i === 4 ? 'Absent' : 'Hors ligne'}</small>
            </div>
          ))}
          <Button variant="primary" icon="send" onClick={() => openModal({ kind: 'communication', title: 'Communiquer avec l’équipe de crise' })}>
            Communiquer avec l’équipe
          </Button>
        </div>
      );
    }
'''
    comm = '''    else if (modal.kind === "communication") {
      title = modal.title || 'Contacter un média';
      body = <ContactComposer entity={entity} />;
    }
'''
    s = s[:start] + team + comm + s[s.find('\n    }', end)+5 if False else s[:start] + team + comm + s[s.find('    }', end):] if False else None
open(p,'w',encoding='utf-8').write(s)
print('ok')
