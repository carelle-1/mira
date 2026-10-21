p=r'C:/xampp/htdocs/EREPUTATION1/src/components/dialogs.tsx'
with open(p,'r',encoding='utf-8',errors='replace') as f:
    s=f.read()
if 'else if (modal.kind === \"communication\")' not in s:
    idx=s.rfind('    }')
    if idx>=0:
        s2=s[:idx] + ' else if (modal.kind === \"communication\") {title=modal.title || \"Contacter un média\";body=<ContactComposer entity={entity} />;}' + s[idx:]
        with open(p,'w',encoding='utf-8') as f:
            f.write(s2)
        print('done')
else:
    print('has')
