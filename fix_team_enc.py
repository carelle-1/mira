p=r'C:/xampp/htdocs/EREPUTATION1/src/components/dialogs.tsx'
s=open(p,'r',encoding='utf-8',errors='replace').read()
i=s.find('team-dialog')
if i>=0:
    start=s.rfind('else if',0,i)
    end=s.find('else if',i+20)
    if start>=0 and end>i:
        blk=s[start:end]
        # normalize
        blk=blk.replace('quipe de crise','Équipe de crise')
        blk=blk.replace('l\'quipe','l\'équipe')
        blk=blk.replace('lquipe','léquipe')
        # remove mojibake sequences
        import re
        blk=re.sub(r'Ã[^\s\']*', 'É', blk)
        blk=blk.replace('ÉÉ','É')
        s2=s[:start]+blk+s[end:]
        open(p,'w',encoding='utf-8').write(s2)
        print('done')
    else:
        print('no2')
else:
    print('no1')
