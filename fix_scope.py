p=r'C:/xampp/htdocs/EREPUTATION1/src/components/dialogs.tsx'
s=open(p,'r',encoding='utf-8',errors='replace').read()
old='    else if (modal.kind === \"team\") {\n      title=\"Équipe de crise\";\n      body=(\n'
# simpler
s=s.replace('title=\"Équipe de crise\";','let title=\"Équipe de crise\";')
s=s.replace('body=(\n','let body=(\n')
open(p,'w',encoding='utf-8').write(s)
print('ok')
