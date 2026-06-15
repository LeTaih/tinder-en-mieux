import { Alert } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafetyMenu } from './SafetyMenu';

const mockBlockMutate = jest.fn();
const mockReportMutate = jest.fn();

jest.mock('./use-safety', () => ({
  useBlockUser: () => ({ mutate: mockBlockMutate }),
  useReportUser: () => ({ mutate: mockReportMutate }),
}));

describe('SafetyMenu', () => {
  beforeEach(() => {
    mockBlockMutate.mockClear();
    mockReportMutate.mockClear();
  });

  it('ouvre le menu et affiche Bloquer / Signaler', () => {
    render(<SafetyMenu targetId="u1" />);
    fireEvent.press(screen.getByLabelText('Options'));
    expect(screen.getByText('Bloquer')).toBeTruthy();
    expect(screen.getByText('Signaler')).toBeTruthy();
  });

  it('« Signaler » révèle les motifs et envoie le bon motif', () => {
    render(<SafetyMenu targetId="u1" />);
    fireEvent.press(screen.getByLabelText('Options'));
    fireEvent.press(screen.getByText('Signaler'));
    expect(screen.getByText('Harcèlement')).toBeTruthy();
    fireEvent.press(screen.getByText('Harcèlement'));
    expect(mockReportMutate).toHaveBeenCalledWith(
      { targetId: 'u1', reason: 'harcelement' },
      expect.any(Object),
    );
  });

  it("« Bloquer » demande confirmation avant d'agir", () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    render(<SafetyMenu targetId="u1" />);
    fireEvent.press(screen.getByLabelText('Options'));
    fireEvent.press(screen.getByText('Bloquer'));
    expect(spy).toHaveBeenCalled();
    expect(mockBlockMutate).not.toHaveBeenCalled(); // l'action attend la confirmation
    spy.mockRestore();
  });
});
