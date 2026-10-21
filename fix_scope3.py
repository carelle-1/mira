p=r'C:/xampp/htdocs/EREPUTATION1/src/components/dialogs.tsx'
s=open(p,'r',encoding='utf-8',errors='replace').read()
s=s.replace('modal.kind === \"team\"', 'modal.kind === \"team\"')
open(p,'w',encoding='utf-8').write(s)
print('ok')
