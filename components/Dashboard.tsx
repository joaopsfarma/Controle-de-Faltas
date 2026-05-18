import { useState, useEffect, useMemo, useRef } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { db, auth } from '@/src/lib/firebase';
import { handleFirestoreError } from '@/src/lib/firestore-error';
import { collection, query, onSnapshot, doc, setDoc, updateDoc, where, serverTimestamp, writeBatch } from 'firebase/firestore';
import { CsvItem, ShortageReport, OperationType } from '@/src/types';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Plus, CheckCircle, FileText, BarChart2, TrendingUp, Upload, Download, Target, Activity } from 'lucide-react';
import { toast } from 'sonner';
import { format, subDays, startOfDay, isSameDay } from 'date-fns';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell } from 'recharts';

export default function Dashboard({ user }: { user: any }) {
  const [csvItems, setCsvItems] = useState<CsvItem[]>([]);
  const [shortages, setShortages] = useState<ShortageReport[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<CsvItem | null>(null);
  const [reportQty, setReportQty] = useState('');
  const [reportNotes, setReportNotes] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isResolveOpen, setIsResolveOpen] = useState(false);
  const [selectedShortage, setSelectedShortage] = useState<ShortageReport | null>(null);
  const [actionTakenText, setActionTakenText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Load catalog from Firebase
    if (auth.currentUser) {
      const catalogQuery = query(
        collection(db, 'catalog'),
        where('status', '==', 'Ativo')
      );

      const unsubCatalog = onSnapshot(catalogQuery, (snapshot) => {
        const items: CsvItem[] = [];
        snapshot.forEach(docSnap => {
          const data = docSnap.data();
          items.push({
            status: data.status,
            itemId: data.itemId,
            itemName: data.itemName,
            isMissing: data.isMissing,
            quantityTotal: data.quantityTotal,
            quantityPending: data.quantityPending
          });
        });
        setCsvItems(items);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'catalog');
      });

      // Realtime Firebase subscription for shortages
      const shortageQuery = user?.email === 'joaopsfarma@gmail.com' 
         ? query(collection(db, 'shortages'))
         : query(
             collection(db, 'shortages'),
             where('userId', '==', auth.currentUser.uid)
           );

      const unsubShortages = onSnapshot(shortageQuery, (snapshot) => {
        const specs: ShortageReport[] = [];
        snapshot.forEach(docSnap => {
          const data = docSnap.data();
          specs.push({
            id: docSnap.id,
            itemId: data.itemId,
            itemName: data.itemName,
            reportedQuantity: data.reportedQuantity,
            reportedAt: data.reportedAt?.toDate?.() || new Date(data.reportedAt || Date.now()),
            userId: data.userId,
            status: data.status,
            notes: data.notes
          });
        });
        // Sort newest first
        specs.sort((a, b) => new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime());
        setShortages(specs);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'shortages');
      });
      
      return () => {
        unsubCatalog();
        unsubShortages();
      };
    }
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const parsedItems: any[] = [];
          
          results.data.forEach((row: any) => {
            if (!Array.isArray(row)) return;
            
            let productStr = '';
            let qtyStr = '0';
            
            for (let i = 0; i < row.length; i++) {
              const cell = String(row[i]).trim();
              if (/^\d+\s*-.+/.test(cell)) {
                productStr = cell;
                
                // Try to find quantity (first column with numbers like "190,0000" or "1.079,0000")
                for (let j = i + 1; j < row.length; j++) {
                  const val = String(row[j]).trim().replace(/['"]/g, '');
                  if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(val)) {
                    qtyStr = val;
                    break;
                  }
                }
                break;
              }
            }

            if (productStr) {
              const parts = productStr.split('-');
              const itemId = parts[0].trim().replace(/[^a-zA-Z0-9_\-]/g, '');
              const itemName = parts.slice(1).join('-').trim().substring(0, 500);
              const quantityTotal = parseFloat(qtyStr.replace(/\./g, '').replace(',', '.')) || 0;
              
              if (itemId && itemName) {
                 parsedItems.push({
                   status: 'Ativo',
                   itemId,
                   itemName,
                   isMissing: false,
                   quantityTotal,
                   quantityPending: 0
                 });
              }
            }
          });

          if (parsedItems.length === 0) {
            toast.error('Nenhum item válido encontrado no CSV.');
            setIsUploading(false);
            return;
          }

          // Upload in batches of 500
          for (let i = 0; i < parsedItems.length; i += 500) {
            const batch = writeBatch(db);
            const chunk = parsedItems.slice(i, i + 500);
            
            chunk.forEach(item => {
              const docRef = doc(db, 'catalog', item.itemId);
              batch.set(docRef, {
                ...item,
                updatedAt: serverTimestamp()
              });
            });
            
            await batch.commit();
          }

          toast.success(`${parsedItems.length} itens do catálogo carregados com sucesso!`);
        } catch (error) {
          console.error(error);
          toast.error('Erro ao importar CSV. Verifique o console.');
        } finally {
          setIsUploading(false);
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
        }
      },
      error: () => {
        toast.error('Erro ao ler arquivo CSV');
        setIsUploading(false);
      }
    });
  };

  const handleReportShortage = async () => {
    if (!selectedItem) {
      toast.error('Selecione um item');
      return;
    }
    
    const qty = parseInt(reportQty, 10);
    if (isNaN(qty) || qty <= 0) {
      toast.error('Quantidade reportada deve ser um número positivo');
      return;
    }

    try {
      // Validate string sizes according to security rules
      const finalItemName = selectedItem.itemName.substring(0, 500);
      const finalNotes = reportNotes.substring(0, 1000);
      
      // Use document ID generator
      const docRef = doc(collection(db, 'shortages'));
      const payload: any = {
        itemId: selectedItem.itemId,
        itemName: finalItemName,
        reportedQuantity: qty,
        reportedAt: serverTimestamp(),
        userId: auth.currentUser!.uid,
        status: 'pending'
      };

      if (finalNotes.trim().length > 0) {
        payload.notes = finalNotes.trim();
      }

      await setDoc(docRef, payload);
      
      toast.success('Falta reportada com sucesso');
      setIsReportOpen(false);
      setSelectedItem(null);
      setReportQty('');
      setReportNotes('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'shortages');
    }
  };

  const handleResolveShortage = async () => {
    if (!selectedShortage?.id) return;
    try {
      const docRef = doc(db, 'shortages', selectedShortage.id);
      await updateDoc(docRef, {
        status: 'resolved',
        actionTaken: actionTakenText
      });
      toast.success('Falta resolvida');
      setIsResolveOpen(false);
      setSelectedShortage(null);
      setActionTakenText('');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `shortages/${selectedShortage.id}`);
    }
  };

  const exportToExcel = () => {
    const wsData = shortages.map(s => ({
      Data: s.reportedAt instanceof Date ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(s.reportedAt) : '',
      'Código': s.itemId,
      Item: s.itemName,
      'Quantidade Faltante': s.reportedQuantity,
      Status: s.status === 'resolved' ? 'Resolvido' : 'Pendente',
      Observações: s.notes || '',
      'Ação Tomada': s.actionTaken || ''
    }));

    const ws = XLSX.utils.json_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Faltas');
    XLSX.writeFile(wb, `relatorio_faltas_${format(new Date(), 'dd-MM-yyyy')}.xlsx`);
  };

  const filteredItems = csvItems.filter(item => 
    item.itemName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.itemId.includes(searchTerm)
  );

  const chartData = useMemo(() => {
    // Show last 7 days of reports
    const data = [];
    for (let i = 6; i >= 0; i--) {
      const date = subDays(new Date(), i);
      const dayShortages = shortages.filter(s => 
        s.reportedAt && isSameDay(new Date(s.reportedAt), date)
      );
      data.push({
        date: format(date, 'dd/MM'),
        faltas: dayShortages.length,
        pendentes: dayShortages.filter(s => s.status === 'pending').length,
        resolvidas: dayShortages.filter(s => s.status === 'resolved').length
      });
    }
    return data;
  }, [shortages]);

  const topMissingItems = useMemo(() => {
    const map = new Map<string, {name: string, quantity: number}>();
    shortages.forEach(s => {
      if (s.status === 'pending') {
        const existing = map.get(s.itemId) || { name: s.itemName, quantity: 0 };
        existing.quantity += s.reportedQuantity;
        map.set(s.itemId, existing);
      }
    });
    return Array.from(map.entries())
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);
  }, [shortages]);

  const statusData = useMemo(() => {
    const pending = shortages.filter(s => s.status === 'pending').length;
    const resolved = shortages.filter(s => s.status === 'resolved').length;
    return [
      { name: 'Pendentes', value: pending, color: '#f59e0b' },
      { name: 'Resolvidas', value: resolved, color: '#10b981' }
    ];
  }, [shortages]);

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-900 font-sans">
      <header className="banner-gradiente shrink-0 shadow-sm flex-col sm:flex-row relative">
        <div className="absolute inset-0 flex items-center px-4 sm:px-6 w-full justify-between">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <h1 className="titulo-rede truncate drop-shadow-md pb-1 border-white" style={{ color: 'white' }}>Gestão de Faltas<span className="hidden sm:inline"> - Central de Abastecimento</span></h1>
          </div>
          <div className="sm:ml-auto flex items-center justify-between w-full sm:w-auto gap-4">
            <div className="flex items-center gap-2">
              {user?.email === 'joaopsfarma@gmail.com' && (
                <>
                  <input 
                    type="file" 
                    accept=".csv" 
                    className="hidden" 
                    ref={fileInputRef} 
                    onChange={handleFileUpload} 
                  />
                  <button 
                    className="botao-primario flex items-center gap-2"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    style={{ background: 'rgba(255, 255, 255, 0.2)', color: 'white', border: '1px solid rgba(255, 255, 255, 0.4)' }}
                  >
                    <Upload className="h-4 w-4 hidden sm:block" />
                    {isUploading ? '...' : <><span className="hidden sm:inline">Importar CSV</span><Upload className="sm:hidden h-4 w-4" /></>}
                  </button>
                </>
              )}
              <span className="text-sm font-medium text-white truncate max-w-[120px] sm:max-w-none ml-2">
                {auth.currentUser?.displayName 
                  ? `${auth.currentUser.displayName} (Anônimo)` 
                  : auth.currentUser?.isAnonymous 
                    ? 'Usuário Anônimo' 
                    : auth.currentUser?.email}
              </span>
            </div>
            <button className="botao-primario" style={{ padding: '6px 12px', fontSize: '0.875rem' }} onClick={() => auth.signOut()}>Sair</button>
          </div>
        </div>
      </header>
      
      <main className="flex-1 overflow-auto p-4 sm:p-6 md:p-8">
        <div className="mx-auto max-w-6xl space-y-6 sm:space-y-8">
          
          <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-3">
            <Card className="bg-white">
              <CardContent className="flex items-center gap-4 p-4 sm:p-6">
                <div className="rounded-full bg-blue-100 p-3 text-blue-600">
                  <FileText className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">Itens no Catálogo</p>
                  <p className="text-2xl font-bold">{csvItems.length}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-white">
              <CardContent className="flex items-center gap-4 p-4 sm:p-6">
                <div className="rounded-full bg-amber-100 p-3 text-amber-600">
                  <BarChart2 className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">Faltas Pendentes</p>
                  <p className="text-2xl font-bold">{shortages.filter(s => s.status === 'pending').length}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-white">
              <CardContent className="flex items-center gap-4 p-4 sm:p-6">
                <div className="rounded-full bg-emerald-100 p-3 text-emerald-600">
                  <CheckCircle className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">Faltas Resolvidas</p>
                  <p className="text-2xl font-bold">{shortages.filter(s => s.status === 'resolved').length}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="catalog">
            <div className="overflow-x-auto pb-1 mb-2">
              <TabsList className="w-full sm:w-auto inline-flex justify-start border-b rounded-none h-auto bg-transparent p-0 min-w-max">
                <TabsTrigger value="catalog" className="text-sm rounded-none border-b-2 border-transparent data-[state=active]:border-indigo-600 data-[state=active]:bg-transparent px-3 sm:px-4 py-3">
                  Catálogo CSV
                </TabsTrigger>
                <TabsTrigger value="shortages" className="text-sm rounded-none border-b-2 border-transparent data-[state=active]:border-indigo-600 data-[state=active]:bg-transparent px-3 sm:px-4 py-3">
                  Identificação de Faltas
                </TabsTrigger>
                <TabsTrigger value="kpis" className="text-sm rounded-none border-b-2 border-transparent data-[state=active]:border-indigo-600 data-[state=active]:bg-transparent px-3 sm:px-4 py-3 text-indigo-600 flex items-center gap-2">
                  <Activity className="h-4 w-4 hidden sm:block" /> Indicadores & KPIs
                </TabsTrigger>
                <TabsTrigger value="reports" className="text-sm rounded-none border-b-2 border-transparent data-[state=active]:border-indigo-600 data-[state=active]:bg-transparent px-3 sm:px-4 py-3 text-indigo-600 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 hidden sm:block" /> Relatório Periódico
                </TabsTrigger>
              </TabsList>
            </div>
            
            <TabsContent value="catalog" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Catálogo de Itens do Estoque (Mapeado no Firebase)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="mb-4 relative">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                    <Input 
                      placeholder="Buscar por nome ou código..." 
                      className="pl-9"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                  <div className="rounded-md border max-h-[500px] overflow-auto">
                    <Table className="min-w-[500px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Código</TableHead>
                          <TableHead>Descrição</TableHead>
                          <TableHead className="text-right">Qtd Total</TableHead>
                          <TableHead className="text-center">Ação</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredItems.slice(0, 100).map((item, idx) => (
                          <TableRow key={`${item.itemId}-${idx}`}>
                            <TableCell className="font-medium">{item.itemId}</TableCell>
                            <TableCell>{item.itemName}</TableCell>
                            <TableCell className="text-right">{item.quantityTotal}</TableCell>
                            <TableCell className="text-center">
                              <Dialog open={isReportOpen && selectedItem?.itemId === item.itemId} onOpenChange={(open) => {
                                setIsReportOpen(open);
                                if (open) {
                                  setSelectedItem(item);
                                  setReportQty('');
                                  setReportNotes('');
                                } else {
                                  setSelectedItem(null);
                                }
                              }}>
                                <DialogTrigger render={<Button size="sm" variant="secondary" className="h-8" />}>
                                  <Plus className="mr-1 h-3 w-3" /> Reportar
                                </DialogTrigger>
                                <DialogContent>
                                  <DialogHeader>
                                    <DialogTitle>Reportar Falta de Item</DialogTitle>
                                  </DialogHeader>
                                  <div className="space-y-4 py-4">
                                    <div className="space-y-1">
                                      <p className="text-sm font-medium text-gray-500">Item Selecionado</p>
                                      <p className="font-medium">{item.itemName}</p>
                                      <p className="text-xs text-gray-400">Código: {item.itemId}</p>
                                    </div>
                                    <div className="space-y-2">
                                      <Label htmlFor="qty">Quantidade em Falta</Label>
                                      <Input 
                                        id="qty" 
                                        type="number" 
                                        min="1" 
                                        value={reportQty} 
                                        onChange={(e) => setReportQty(e.target.value)} 
                                        placeholder="Ex: 5"
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <Label htmlFor="notes">Motivo / Observações</Label>
                                      <Select value={reportNotes} onValueChange={setReportNotes}>
                                        <SelectTrigger id="notes">
                                          <SelectValue placeholder="Selecione o motivo..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="Estoque zerado">Estoque zerado</SelectItem>
                                          <SelectItem value="Estoque divergente">Estoque divergente</SelectItem>
                                          <SelectItem value="Não encontrado">Não encontrado</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                  </div>
                                  <DialogFooter>
                                    <Button variant="outline" onClick={() => setIsReportOpen(false)}>Cancelar</Button>
                                    <Button onClick={handleReportShortage}>Confirmar Falta</Button>
                                  </DialogFooter>
                                </DialogContent>
                              </Dialog>
                            </TableCell>
                          </TableRow>
                        ))}
                        {filteredItems.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={4} className="h-24 text-center text-gray-500">Nenhum item encontrado.</TableCell>
                          </TableRow>
                        )}
                        {filteredItems.length > 100 && (
                          <TableRow>
                            <TableCell colSpan={4} className="h-10 text-center text-xs text-gray-400">Mostrando os primeiros 100 resultados. Use a busca para filtrar.</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="shortages" className="mt-6">
              <Card>
                <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <CardTitle className="text-lg">Relatório de Faltas Reportadas</CardTitle>
                  <Button variant="secondary" size="sm" onClick={exportToExcel} className="w-full sm:w-auto">
                    <Download className="mr-2 h-4 w-4" /> Exportar Excel
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border overflow-x-auto">
                    <Table className="min-w-[600px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Data</TableHead>
                          <TableHead>Código</TableHead>
                          <TableHead>Item</TableHead>
                          <TableHead className="text-right">Qtd Faltante</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-center">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {shortages.map(shortage => (
                          <TableRow key={shortage.id}>
                            <TableCell className="text-xs text-gray-500">
                              {shortage.reportedAt instanceof Date 
                                ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(shortage.reportedAt)
                                : '...'}
                            </TableCell>
                            <TableCell className="font-medium text-xs">{shortage.itemId}</TableCell>
                            <TableCell className="text-sm">
                              {shortage.itemName}
                              {shortage.notes && <p className="text-xs text-gray-500 mt-1">Obs: {shortage.notes}</p>}
                              {shortage.actionTaken && <p className="text-xs text-emerald-600 mt-1">Ação: {shortage.actionTaken}</p>}
                            </TableCell>
                            <TableCell className="text-right font-medium">{shortage.reportedQuantity}</TableCell>
                            <TableCell>
                              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                shortage.status === 'resolved' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                              }`}>
                                {shortage.status === 'resolved' ? 'Resolvido' : 'Pendente'}
                              </span>
                            </TableCell>
                            <TableCell className="text-center">
                              {shortage.status === 'pending' && !auth.currentUser?.isAnonymous && (
                                <Dialog open={isResolveOpen && selectedShortage?.id === shortage.id} onOpenChange={(open) => {
                                  setIsResolveOpen(open);
                                  if (open) {
                                    setSelectedShortage(shortage);
                                    setActionTakenText('');
                                  } else {
                                    setSelectedShortage(null);
                                  }
                                }}>
                                  <DialogTrigger render={<Button variant="outline" size="sm" className="h-7 text-emerald-600 border-emerald-200 hover:bg-emerald-50" />}>
                                    <CheckCircle className="mr-1 h-3 w-3" /> Resolver
                                  </DialogTrigger>
                                  <DialogContent>
                                    <DialogHeader>
                                      <DialogTitle>Resolver Falta</DialogTitle>
                                    </DialogHeader>
                                    <div className="space-y-4 py-4">
                                      <div className="space-y-2">
                                        <Label htmlFor="actionTaken">Ação Tomada</Label>
                                        <Select value={actionTakenText} onValueChange={setActionTakenText}>
                                          <SelectTrigger id="actionTaken">
                                            <SelectValue placeholder="Selecione a ação tomada..." />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="Contatado planejamento">Contatado planejamento</SelectItem>
                                            <SelectItem value="Compra drogaria">Compra drogaria</SelectItem>
                                            <SelectItem value="Transferência entre empresas">Transferência entre empresas</SelectItem>
                                            <SelectItem value="Substituição">Substituição</SelectItem>
                                            <SelectItem value="Inventário">Inventário</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      </div>
                                    </div>
                                    <DialogFooter>
                                      <Button variant="outline" onClick={() => setIsResolveOpen(false)}>Cancelar</Button>
                                      <Button onClick={handleResolveShortage} disabled={!actionTakenText.trim()}>Confirmar e Resolver</Button>
                                    </DialogFooter>
                                  </DialogContent>
                                </Dialog>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                        {shortages.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={6} className="h-24 text-center text-gray-500">Nenhuma falta reportada no momento.</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="kpis" className="mt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Volume de Faltas por Status</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[300px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={statusData}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={100}
                            paddingAngle={5}
                            dataKey="value"
                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          >
                            {statusData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Top 5 Itens com Mais Faltas (Pendentes)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[300px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={topMissingItems} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                          <XAxis type="number" />
                          <YAxis dataKey="name" type="category" width={150} tick={{fontSize: 12}} />
                          <Tooltip />
                          <Bar dataKey="quantity" name="Quantidade Faltante" fill="#ef4444" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="reports" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Relatório Periódico de Faltas (Últimos 7 dias)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[400px] w-full mt-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="date" />
                        <YAxis />
                        <Tooltip 
                          cursor={{fill: '#f3f4f6'}}
                          contentStyle={{borderRadius: '8px', border: '1px solid #e5e7eb', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                        />
                        <Legend />
                        <Bar name="Pendentes" dataKey="pendentes" stackId="a" fill="#fbbf24" radius={[0, 0, 4, 4]} />
                        <Bar name="Resolvidas" dataKey="resolvidas" stackId="a" fill="#34d399" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

          </Tabs>
        </div>
      </main>
    </div>
  );
}

