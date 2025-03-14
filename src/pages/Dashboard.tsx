
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { getUserTablatures } from '@/lib/supabase';
import { TablatureData } from '@/lib/tablature';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Calendar, FileMusic, Clock, Download, Plus } from 'lucide-react';

const Dashboard = () => {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [tablatures, setTablatures] = useState<TablatureData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Redirect if not logged in
    if (!user) {
      navigate('/auth');
      return;
    }

    const fetchTablatures = async () => {
      try {
        setIsLoading(true);
        const data = await getUserTablatures(user.id);
        setTablatures(data);
      } catch (error) {
        console.error('Error fetching tablatures:', error);
        toast({
          title: 'Error loading tablatures',
          description: 'Could not load your tablatures. Please try again.',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchTablatures();
  }, [user, navigate, toast]);

  const handleSignOut = async () => {
    try {
      await signOut();
      toast({
        title: 'Signed out',
        description: 'You have been successfully signed out.',
      });
      navigate('/');
    } catch (error) {
      toast({
        title: 'Error signing out',
        description: 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="flex flex-col min-h-screen">
      <Header />

      <main className="flex-grow pt-24 pb-16 px-6 md:px-10 bg-gray-50 dark:bg-gray-900">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-10">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold mb-2">Dashboard</h1>
              <p className="text-gray-600 dark:text-gray-400">
                Welcome back, {user?.email}!
              </p>
            </div>
            <div className="mt-4 md:mt-0 flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2">
              <Button onClick={() => navigate('/')} variant="outline" className="flex items-center space-x-2">
                <Plus className="h-4 w-4" />
                <span>New Tablature</span>
              </Button>
              <Button onClick={handleSignOut} variant="ghost">
                Sign Out
              </Button>
            </div>
          </div>

          <Tabs defaultValue="all" className="mb-6">
            <TabsList>
              <TabsTrigger value="all">All Tablatures</TabsTrigger>
              <TabsTrigger value="guitar">Guitar</TabsTrigger>
              <TabsTrigger value="bass">Bass</TabsTrigger>
            </TabsList>
            
            <TabsContent value="all">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <Card key={i} className="animate-pulse">
                      <CardHeader className="h-24 bg-gray-100 dark:bg-gray-800"></CardHeader>
                      <CardContent className="pt-4 space-y-2">
                        <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded"></div>
                        <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-3/4"></div>
                      </CardContent>
                    </Card>
                  ))
                ) : tablatures.length === 0 ? (
                  <div className="col-span-full text-center py-12">
                    <FileMusic className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                    <h3 className="text-lg font-medium mb-2">No tablatures yet</h3>
                    <p className="text-gray-600 dark:text-gray-400 mb-6">
                      Upload audio or video to generate your first tablature
                    </p>
                    <Button onClick={() => navigate('/')} className="bg-tabgenius-700 hover:bg-tabgenius-800">
                      Create Your First Tablature
                    </Button>
                  </div>
                ) : (
                  tablatures.map((tab) => (
                    <Card key={tab.id} className="hover:shadow-md transition-shadow">
                      <CardHeader>
                        <div className="flex justify-between items-start">
                          <div>
                            <CardTitle className="text-lg">{tab.title}</CardTitle>
                            <CardDescription className="flex items-center mt-1">
                              <span className="capitalize">{tab.instrument}</span>
                              <span className="mx-2">•</span>
                              <span>{tab.key}</span>
                            </CardDescription>
                          </div>
                          <div className="px-2 py-1 bg-tabgenius-100 text-tabgenius-800 text-xs rounded-full">
                            {tab.tempo} BPM
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="pb-0">
                        <div className="flex items-center text-sm text-gray-500 space-x-4">
                          <div className="flex items-center">
                            <Clock className="h-4 w-4 mr-1" />
                            <span>{tab.created_at ? formatDate(tab.created_at) : 'Recent'}</span>
                          </div>
                          <div className="flex items-center">
                            <Calendar className="h-4 w-4 mr-1" />
                            <span>{tab.tuning}</span>
                          </div>
                        </div>
                      </CardContent>
                      <CardFooter className="pt-4 pb-4">
                        <Button variant="outline" className="w-full flex items-center justify-center">
                          <Download className="h-4 w-4 mr-2" />
                          <span>Download</span>
                        </Button>
                      </CardFooter>
                    </Card>
                  ))
                )}
              </div>
            </TabsContent>
            
            <TabsContent value="guitar">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
                {!isLoading && tablatures.filter(tab => tab.instrument === 'guitar').length === 0 ? (
                  <div className="col-span-full text-center py-12">
                    <FileMusic className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                    <h3 className="text-lg font-medium mb-2">No guitar tablatures</h3>
                    <p className="text-gray-600 dark:text-gray-400 mb-6">
                      Generate your first guitar tablature by uploading audio or video
                    </p>
                    <Button onClick={() => navigate('/')} className="bg-tabgenius-700 hover:bg-tabgenius-800">
                      Generate Guitar Tablature
                    </Button>
                  </div>
                ) : (
                  tablatures
                    .filter(tab => tab.instrument === 'guitar')
                    .map((tab) => (
                      <Card key={tab.id} className="hover:shadow-md transition-shadow">
                        <CardHeader>
                          <div className="flex justify-between items-start">
                            <div>
                              <CardTitle className="text-lg">{tab.title}</CardTitle>
                              <CardDescription className="flex items-center mt-1">
                                <span className="capitalize">{tab.instrument}</span>
                                <span className="mx-2">•</span>
                                <span>{tab.key}</span>
                              </CardDescription>
                            </div>
                            <div className="px-2 py-1 bg-tabgenius-100 text-tabgenius-800 text-xs rounded-full">
                              {tab.tempo} BPM
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="pb-0">
                          <div className="flex items-center text-sm text-gray-500 space-x-4">
                            <div className="flex items-center">
                              <Clock className="h-4 w-4 mr-1" />
                              <span>{tab.created_at ? formatDate(tab.created_at) : 'Recent'}</span>
                            </div>
                            <div className="flex items-center">
                              <Calendar className="h-4 w-4 mr-1" />
                              <span>{tab.tuning}</span>
                            </div>
                          </div>
                        </CardContent>
                        <CardFooter className="pt-4 pb-4">
                          <Button variant="outline" className="w-full flex items-center justify-center">
                            <Download className="h-4 w-4 mr-2" />
                            <span>Download</span>
                          </Button>
                        </CardFooter>
                      </Card>
                    ))
                )}
              </div>
            </TabsContent>
            
            <TabsContent value="bass">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
                {!isLoading && tablatures.filter(tab => tab.instrument === 'bass').length === 0 ? (
                  <div className="col-span-full text-center py-12">
                    <FileMusic className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                    <h3 className="text-lg font-medium mb-2">No bass tablatures</h3>
                    <p className="text-gray-600 dark:text-gray-400 mb-6">
                      Generate your first bass tablature by uploading audio or video
                    </p>
                    <Button onClick={() => navigate('/')} className="bg-tabgenius-700 hover:bg-tabgenius-800">
                      Generate Bass Tablature
                    </Button>
                  </div>
                ) : (
                  tablatures
                    .filter(tab => tab.instrument === 'bass')
                    .map((tab) => (
                      <Card key={tab.id} className="hover:shadow-md transition-shadow">
                        <CardHeader>
                          <div className="flex justify-between items-start">
                            <div>
                              <CardTitle className="text-lg">{tab.title}</CardTitle>
                              <CardDescription className="flex items-center mt-1">
                                <span className="capitalize">{tab.instrument}</span>
                                <span className="mx-2">•</span>
                                <span>{tab.key}</span>
                              </CardDescription>
                            </div>
                            <div className="px-2 py-1 bg-tabgenius-100 text-tabgenius-800 text-xs rounded-full">
                              {tab.tempo} BPM
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="pb-0">
                          <div className="flex items-center text-sm text-gray-500 space-x-4">
                            <div className="flex items-center">
                              <Clock className="h-4 w-4 mr-1" />
                              <span>{tab.created_at ? formatDate(tab.created_at) : 'Recent'}</span>
                            </div>
                            <div className="flex items-center">
                              <Calendar className="h-4 w-4 mr-1" />
                              <span>{tab.tuning}</span>
                            </div>
                          </div>
                        </CardContent>
                        <CardFooter className="pt-4 pb-4">
                          <Button variant="outline" className="w-full flex items-center justify-center">
                            <Download className="h-4 w-4 mr-2" />
                            <span>Download</span>
                          </Button>
                        </CardFooter>
                      </Card>
                    ))
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </main>
      
      <Footer />
    </div>
  );
};

export default Dashboard;
