p=r'C:/xampp/htdocs/EREPUTATION1/src/components/dialogs.tsx'
with open(p,'r',encoding='utf-8',errors='replace') as f:
    s=f.read()
if 'else if (modal.kind === \"communication\")' not in s:
    # insert before else setError
    s=s.replace('    }\n    else setError(modal.kind);', '    } else if (modal.kind === \"communication\") {title=modal.title || \"Contacter un média\";body=<ContactComposer entity={entity} />;} else setError(modal.kind);', 1)
with open(p,'w',encoding='utf-8') as f:
    f.write(s)
print('ok')
