p=r'C:/xampp/htdocs/EREPUTATION1/src/components/dialogs.tsx'
s=open(p,'r',encoding='utf-8',errors='replace').read()
# remove the bad team block I just added
start=s.find(\"else if (modal.kind === 'team')\")
if start>=0:
    end=s.find('else if', start+1)
    if end>=0:
        s=s[:start] + s[end:]
        open(p,'w',encoding='utf-8').write(s)
        print('removed')
    else:
        print('noend')
else:
    print('nostart')
