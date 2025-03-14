
import { useState } from 'react';
import { Check, CreditCard, Download } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface PaymentCardProps {
  tablatureName: string;
}

const PaymentCard = ({ tablatureName }: PaymentCardProps) => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handlePurchase = () => {
    setLoading(true);
    
    // Simulate payment processing
    setTimeout(() => {
      setLoading(false);
      
      toast({
        title: "Purchase complete!",
        description: "Your tablature is ready to download.",
      });
    }, 2000);
  };

  return (
    <Card className="w-full shadow-lg transition-all duration-300 transform hover:translate-y-[-4px] overflow-hidden">
      <div className="absolute top-0 right-0 bg-tabgenius-700 text-white px-4 py-1 text-xs font-bold">
        PREMIUM
      </div>
      
      <CardHeader>
        <CardTitle className="text-xl">{tablatureName}</CardTitle>
        <CardDescription>Complete Tablature Package</CardDescription>
      </CardHeader>
      
      <CardContent>
        <div className="flex items-center justify-center">
          <div className="text-center">
            <div className="flex items-baseline justify-center">
              <span className="text-3xl font-bold">$3.99</span>
              <span className="text-sm text-gray-500 ml-1">one-time</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">No subscription required</p>
          </div>
        </div>
        
        <div className="mt-6 space-y-3">
          <div className="flex items-start">
            <Check className="h-5 w-5 text-green-500 mr-2 flex-shrink-0 mt-0.5" />
            <p className="text-sm">Full tablature in Guitar Pro format</p>
          </div>
          <div className="flex items-start">
            <Check className="h-5 w-5 text-green-500 mr-2 flex-shrink-0 mt-0.5" />
            <p className="text-sm">Standard musical notation</p>
          </div>
          <div className="flex items-start">
            <Check className="h-5 w-5 text-green-500 mr-2 flex-shrink-0 mt-0.5" />
            <p className="text-sm">Technique analysis and breakdown</p>
          </div>
          <div className="flex items-start">
            <Check className="h-5 w-5 text-green-500 mr-2 flex-shrink-0 mt-0.5" />
            <p className="text-sm">Printable PDF version</p>
          </div>
          <div className="flex items-start">
            <Check className="h-5 w-5 text-green-500 mr-2 flex-shrink-0 mt-0.5" />
            <p className="text-sm">Lifetime access to this tablature</p>
          </div>
        </div>
      </CardContent>
      
      <CardFooter className="flex flex-col space-y-3">
        <Button 
          className="w-full bg-tabgenius-700 hover:bg-tabgenius-800 text-white flex items-center justify-center"
          disabled={loading}
          onClick={handlePurchase}
        >
          {loading ? (
            <div className="flex items-center">
              <div className="h-4 flex items-end space-x-1 mr-2">
                <div className="waveform-bar animate-wave1 bg-white w-1"></div>
                <div className="waveform-bar animate-wave2 bg-white w-1"></div>
                <div className="waveform-bar animate-wave3 bg-white w-1"></div>
              </div>
              Processing...
            </div>
          ) : (
            <>
              <CreditCard className="h-4 w-4 mr-2" />
              Purchase Now
            </>
          )}
        </Button>
        
        <Button 
          variant="outline" 
          className="w-full"
        >
          <Download className="h-4 w-4 mr-2" />
          Download Sample
        </Button>
      </CardFooter>
    </Card>
  );
};

export default PaymentCard;
