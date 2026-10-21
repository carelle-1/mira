p=r'C:/xampp/htdocs/EREPUTATION1/src/components/dialogs.tsx'
s=open(p,'r',encoding='utf-8',errors='replace').read()
# just append closing properly
s=s.rstrip() + '\n'
# ensure ends properly
open(p,'w',encoding='utf-8').write(s)
print('ok')
