import { useState, useEffect, useMemo } from 'react';
import Papa from 'papaparse';
import { db, auth } from '@/src/lib/firebase';
import { handleFirestoreError } from '@/src/lib/firestore-error';
import { collection, query, onSnapshot, doc, setDoc, updateDoc, Timestamp, where, serverTimestamp } from 'firebase/firestore';
import { CsvItem, ShortageReport, OperationType } from '@/src/types';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Search, Plus, CheckCircle, FileText, BarChart2, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { format, subDays, startOfDay, isSameDay } from 'date-fns';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';

export default function Dashboard() {
  const [csvItems, setCsvItems] = useState<CsvItem[]>([]);
  const [shortages, setShortages] = useState<ShortageReport[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<CsvItem | null>(null);
  const [reportQty, setReportQty] = useState('');
  const [reportNotes, setReportNotes] = useState('');

  useEffect(() => {
    // Load default CSV
    fetch('/data.csv')
      .then(res => res.text())
      .then(csv => {
        Papa.parse(csv, {
          header: true,
          delimiter: ';',
          skipEmptyLines: true,
          complete: (results) => {
            const parsed = results.data.map((row: any) => ({
              status: row['Status'] || '',
              itemId: row['Cod Item'] || '',
              itemName: row['Desc Item'] || '',
              isMissing: row['Em Falta'] === 'Sim',
              quantityTotal: parseFloat(row['Qtd. Total']?.replace(',', '.') || '0'),
              quantityPending: parseFloat(row['Qtd Pend']?.replace(',', '.') || '0')
            })).filter((item: CsvItem) => item.itemId && item.status === 'Ativo');
            setCsvItems(parsed);
          }
        });
      });

    // Realtime Firebase subscription for my shortages
    if (auth.currentUser) {
      const q = query(
        collection(db, 'shortages'),
        where('userId', '==', auth.currentUser.uid)
      );

      const unsub = onSnapshot(q, (snapshot) => {
        const specs: ShortageReport[] = [];
        snapshot.forEach(doc => {
          const data = doc.data();
          specs.push({
            id: doc.id,
            itemId: data.itemId,
            itemName: data.itemName,
            reportedQuantity: data.reportedQuantity,
            reportedAt: data.reportedAt?.toDate?.() || new Date(data.reportedAt),
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
        toast.error('Erro ao carregar faltas');
      });
      return () => unsub();
    }
  }, []);

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

  const handleResolveShortage = async (shortage: ShortageReport) => {
    if (!shortage.id) return;
    try {
      const docRef = doc(db, 'shortages', shortage.id);
      await updateDoc(docRef, {
        status: 'resolved'
      });
      toast.success('Falta resolvida');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `shortages/${shortage.id}`);
    }
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

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-900 font-sans">
      <header className="flex h-16 shrink-0 items-center gap-2 border-b bg-white px-6 shadow-sm">
        <FileText className="h-5 w-5 text-indigo-600" />
        <h1 className="text-xl font-semibold tracking-tight text-gray-900">Gestão de Faltas - Central de Abastecimento</h1>
        <div className="ml-auto flex items-center gap-4">
          <span className="text-sm font-medium text-gray-600">{auth.currentUser?.email}</span>
          <Button variant="outline" size="sm" onClick={() => auth.signOut()}>Sair</Button>
        </div>
      </header>
      
      <main className="flex-1 overflow-auto p-6 md:p-8">
        <div className="mx-auto max-w-6xl space-y-8">
          
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <Card className="bg-white">
              <CardContent className="flex items-center gap-4 p-6">
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
              <CardContent className="flex items-center gap-4 p-6">
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
              <CardContent className="flex items-center gap-4 p-6">
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
            <TabsList className="w-full justify-start border-b rounded-none h-auto bg-transparent p-0">
              <TabsTrigger value="catalog" className="rounded-none border-b-2 border-transparent data-[state=active]:border-indigo-600 data-[state=active]:bg-transparent px-4 py-3">
                Catálogo CSV
              </TabsTrigger>
              <TabsTrigger value="shortages" className="rounded-none border-b-2 border-transparent data-[state=active]:border-indigo-600 data-[state=active]:bg-transparent px-4 py-3">
                Identificação de Faltas
              </TabsTrigger>
              <TabsTrigger value="reports" className="rounded-none border-b-2 border-transparent data-[state=active]:border-indigo-600 data-[state=active]:bg-transparent px-4 py-3 text-indigo-600 flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Relatório Periódico
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="catalog" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Catálogo de Itens do Estoque (CSV)</CardTitle>
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
                    <Table>
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
                                <DialogTrigger asChild>
                                  <Button size="sm" variant="secondary" className="h-8">
                                    <Plus className="mr-1 h-3 w-3" /> Reportar
                                  </Button>
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
                                      <Label htmlFor="notes">Observações</Label>
                                      <Input 
                                        id="notes" 
                                        value={reportNotes} 
                                        onChange={(e) => setReportNotes(e.target.value)} 
                                        placeholder="Nota opcional..."
                                      />
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
                <CardHeader>
                  <CardTitle className="text-lg">Relatório de Faltas Reportadas</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border">
                    <Table>
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
                              {shortage.status === 'pending' && (
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  onClick={() => handleResolveShortage(shortage)}
                                  className="h-7 text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                                >
                                  <CheckCircle className="mr-1 h-3 w-3" /> Resolver
                                </Button>
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
