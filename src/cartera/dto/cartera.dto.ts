import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class AddCarteraExpenseDto {
    @IsNumber()
    @Min(0.01)
    amount: number;

    @IsString()
    reason: string;

    @IsOptional()
    @IsString()
    notes?: string;
}

export class AddCarteraIncomeDto {
    @IsNumber()
    @Min(0.01)
    amount: number;

    @IsString()
    reason: string;
}

export class ConvertTransferDto {
    @IsNumber()
    @Min(0.01)
    amount: number;
}
