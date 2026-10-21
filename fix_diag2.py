p=r'C:/xampp/htdocs/EREPUTATION1/src/components/dialogs.tsx'
with open(p,'r',encoding='utf-8',errors='replace') as f:
    s=f.read()
import re
s2=re.sub(r"else if \(modal\.kind === .communication.\) \{title=modal\.title \|\| .Contacter un média.;body=<ContactComposer entity=\{entity\} />;\}\s*\}", 
         "else if (modal.kind === \"communication\") {title=modal.title || \"Contacter un média\";body=<ContactComposer entity={entity} />;}", s)
if s2!=s:
    with open(p,'w',encoding='utf-8') as f:
        f.write(s2)
    print('done')
else:
    print('no')
