p=r'C:/xampp/htdocs/EREPUTATION1/src/components/dialogs.tsx'
s=open(p,'r',encoding='utf-8',errors='replace').read()
s=s.replace('else if (modal.kind === \"team\") {\n      let title=','else if (modal.kind === \"team\") { const title=')
s=s.replace('let body=(\n','const body=(\n')
open(p,'w',encoding='utf-8').write(s)
print('ok')
