export interface ActiveUserData {
  /**
   * Identificador del Usuario (UUID)
   */
  sub: string;

  /**
   * Email del Usuario
   */
  email: string;

  /**
   * Nombre completo del Usuario
   */
  userName: string;

  /**
   * Rol Primario (Ej. Super Administrador, Cajero)
   */
  role: string | null;

  /**
   * Identificador de la Empresa inquilina (UUID) a la que pertenece el usuario
   */
  companyId: string;

  /**
   * Nombre de la Empresa
   */
  companyName: string | null;

  /**
   * Lista de Sucursales a las que el usuario tiene acceso (UUIDs)
   */
  branchIds: string[];

  /**
   * Matriz de permisos de cadena del usuario
   */
  permissions: string[];

  /**
   * Indica si la empresa tiene habilitada la clasificación de ventas (detal/mayorista)
   */
  saleTypeEnabled: boolean;
}
