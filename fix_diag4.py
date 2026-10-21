p=r'C:/xampp/htdocs/EREPUTATION1/src/components/dialogs.tsx'
s=open(p,'r',encoding='utf-8',errors='replace').read()
old='    else setError(modal.kind);'
new='    } else if (modal.kind === "communication") {title=modal.title || "Contacter un média";body=<ContactComposer entity={entity} />;} else setError(modal.kind);'
if 'communication' not in s and old in s:
    s=s.replace(old,new)
    open(p,'w',encoding='utf-8').write(s)
    print('done')
else:
    print('no')
