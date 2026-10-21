import re
p=r'C:/xampp/htdocs/EREPUTATION1/src/components/dialogs.tsx'
s=open(p,encoding='utf-8',errors='replace').read()
s=re.sub(r\"title='[^']*quipe[^']*'\", \"title='Équipe de crise'\", s)
s=s.replace(\"l'quipe\",\"l'équipe\")
s=s.replace('quipe de crise','Équipe de crise')
open(p,'w',encoding='utf-8').write(s)
print('ok')
